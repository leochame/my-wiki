fn main() -> anyhow::Result<()> {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    if arguments.iter().any(|argument| argument == "--version") {
        println!("Rust Remote Office V1 ({})", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if arguments.iter().any(|argument| argument == "--help") {
        println!(
            "Rust Remote Office V1\n\nDesktop: rust-remote-office\nUnattended: rust-remote-office --host [--relay] [--relay-url URL] [--receive-dir PATH] [--monitor INDEX] [--port PORT]\n\nPair and trust the controlling device in the desktop app before using --host."
        );
        return Ok(());
    }
    #[cfg(feature = "desktop")]
    {
        let store = rust_remote_office::config::AppStore::open()?;
        if arguments.iter().any(|argument| argument == "--host") {
            rust_remote_office::headless::run(store, &arguments)
        } else {
            anyhow::ensure!(arguments.is_empty(), "Use --help for available options");
            rust_remote_office::desktop::run(store)
        }
    }
    #[cfg(not(feature = "desktop"))]
    {
        anyhow::bail!("The desktop feature is disabled. Use cargo run --features desktop.")
    }
}
