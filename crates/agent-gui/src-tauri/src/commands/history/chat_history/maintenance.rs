const PROJECT_HISTORY_STALE_AGE_MS: i64 = 3 * 24 * 60 * 60 * 1_000;

fn normalize_project_cwd(cwd: &str) -> Result<String, String> {
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Err("工作空间路径不能为空".to_string());
    }
    Ok(cwd.to_string())
}

fn archive_chat_history_by_cwd_sync(
    conn: &mut Connection,
    cwd: &str,
    archived_at: i64,
) -> Result<ChatHistoryProjectMutationResult, String> {
    let cwd = normalize_project_cwd(cwd)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启项目任务归档事务失败：{e}"))?;
    let mut stmt = tx
        .prepare(
            "
            SELECT id
            FROM chatHistory
            WHERE TRIM(COALESCE(cwd, '')) = ?1
              AND is_archived = 0
            ORDER BY updated_at DESC, id ASC
            ",
        )
        .map_err(|e| format!("准备项目任务归档查询失败：{e}"))?;
    let rows = stmt
        .query_map(params![cwd.as_str()], |row| row.get::<_, String>(0))
        .map_err(|e| format!("查询项目待归档任务失败：{e}"))?;
    let mut conversation_ids = Vec::new();
    for row in rows {
        conversation_ids.push(row.map_err(|e| format!("读取项目待归档任务失败：{e}"))?);
    }
    drop(stmt);

    if conversation_ids.is_empty() {
        return Ok(ChatHistoryProjectMutationResult {
            conversation_ids,
            affected_count: 0,
        });
    }

    let affected_count = tx
        .execute(
            "
            UPDATE chatHistory
            SET is_archived = 1,
                archived_at = ?2
            WHERE TRIM(COALESCE(cwd, '')) = ?1
              AND is_archived = 0
            ",
            params![cwd, archived_at],
        )
        .map_err(|e| format!("归档项目任务失败：{e}"))? as i64;

    tx.commit()
        .map_err(|e| format!("提交项目任务归档事务失败：{e}"))?;

    Ok(ChatHistoryProjectMutationResult {
        conversation_ids,
        affected_count,
    })
}

fn cleanup_chat_history_by_cwd_sync(
    conn: &mut Connection,
    cwd: &str,
    stale_before: i64,
) -> Result<(ChatHistoryProjectMutationResult, subagent_store::SubagentPruneResult), String> {
    let cwd = normalize_project_cwd(cwd)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启项目任务清理事务失败：{e}"))?;
    let conversation_ids = {
        let mut stmt = tx
            .prepare(
                "
                SELECT id
                FROM chatHistory
                WHERE TRIM(COALESCE(cwd, '')) = ?1
                  AND (
                    is_archived = 1
                    OR (is_archived = 0 AND updated_at < ?2)
                  )
                ORDER BY updated_at ASC, id ASC
                ",
            )
            .map_err(|e| format!("准备项目任务清理查询失败：{e}"))?;
        let rows = stmt
            .query_map(params![cwd.as_str(), stale_before], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| format!("查询项目待清理任务失败：{e}"))?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row.map_err(|e| format!("读取项目待清理任务失败：{e}"))?);
        }
        ids
    };

    let mut subagent_prune_result = subagent_store::SubagentPruneResult {
        removed_run_ids: Vec::new(),
        removed_message_count: 0,
        removed_identity_count: 0,
        worktree_cleanup_errors: Vec::new(),
        cleanup_targets: Vec::new(),
    };
    for conversation_id in &conversation_ids {
        let mut prune = delete_chat_history_in_transaction(&tx, conversation_id)?;
        subagent_prune_result
            .removed_run_ids
            .append(&mut prune.removed_run_ids);
        subagent_prune_result.removed_message_count += prune.removed_message_count;
        subagent_prune_result.removed_identity_count += prune.removed_identity_count;
        subagent_prune_result
            .worktree_cleanup_errors
            .append(&mut prune.worktree_cleanup_errors);
        subagent_prune_result
            .cleanup_targets
            .append(&mut prune.cleanup_targets);

    }

    tx.commit()
        .map_err(|e| format!("提交项目任务清理事务失败：{e}"))?;
    Ok((
        ChatHistoryProjectMutationResult {
            affected_count: conversation_ids.len() as i64,
            conversation_ids,
        },
        subagent_prune_result,
    ))
}

pub(crate) async fn chat_history_archive_cwd_inner(
    cwd: String,
) -> Result<ChatHistoryProjectMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        archive_chat_history_by_cwd_sync(&mut conn, &cwd, now_ms())
    })
    .await
    .map_err(|e| format!("chat_history_archive_cwd join 失败：{e}"))?
}

pub(crate) async fn chat_history_cleanup_cwd_inner(
    cwd: String,
) -> Result<ChatHistoryProjectMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        let stale_before = now_ms().saturating_sub(PROJECT_HISTORY_STALE_AGE_MS);
        let (result, mut subagent_prune_result) =
            cleanup_chat_history_by_cwd_sync(&mut conn, &cwd, stale_before)?;
        subagent_store::cleanup_pruned_worktrees(&mut subagent_prune_result);
        if !subagent_prune_result.worktree_cleanup_errors.is_empty() {
            eprintln!(
                "Failed to cleanup some project history subagent worktrees: {}",
                subagent_prune_result.worktree_cleanup_errors.join("; ")
            );
        }
        Ok(result)
    })
    .await
    .map_err(|e| format!("chat_history_cleanup_cwd join 失败：{e}"))?
}

#[tauri::command]
pub async fn chat_history_archive_cwd(
    cwd: String,
    gateway_controller: tauri::State<'_, Arc<GatewayController>>,
) -> Result<ChatHistoryProjectMutationResult, String> {
    let result = chat_history_archive_cwd_inner(cwd).await?;
    for conversation_id in &result.conversation_ids {
        gateway_controller
            .publish_history_sync(build_history_sync_delete(conversation_id.clone()))
            .await;
    }
    Ok(result)
}

#[tauri::command]
pub async fn chat_history_cleanup_cwd(
    cwd: String,
    gateway_controller: tauri::State<'_, Arc<GatewayController>>,
) -> Result<ChatHistoryProjectMutationResult, String> {
    let result = chat_history_cleanup_cwd_inner(cwd).await?;
    for conversation_id in &result.conversation_ids {
        gateway_controller
            .publish_history_sync(build_history_sync_delete(conversation_id.clone()))
            .await;
    }
    Ok(result)
}
