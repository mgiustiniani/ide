//! Run filesystem/process work without occupying Tauri's UI or async executor threads.

pub(super) async fn run<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "The native task ended before producing a result.".to_owned())?
}
