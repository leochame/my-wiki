use crate::{
    capture::native,
    config::AppStore,
    session::{self, HostEvent, HostOptions, NetworkConfig},
};
use anyhow::{Context, Result, bail, ensure};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub fn run(store: AppStore, arguments: &[String]) -> Result<()> {
    ensure!(native::supported(), "Sharing requires macOS or Windows");
    let mut options = HostOptions {
        network: NetworkConfig {
            relay: store.settings.relay,
            relay_url: if store.settings.relay_url.is_empty() {
                None
            } else {
                Some(store.settings.relay_url.parse()?)
            },
            key: store.key,
            port: store.settings.listen_port,
            ..Default::default()
        },
        access: store.access,
        receive_dir: store.settings.receive_dir,
        attended: false,
        ..Default::default()
    };
    let mut arguments = arguments.iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--host" => {}
            "--relay" => options.network.relay = true,
            "--relay-url" => {
                options.network.relay = true;
                options.network.relay_url = Some(
                    arguments
                        .next()
                        .context("--relay-url needs a URL")?
                        .parse()?,
                );
            }
            "--receive-dir" => {
                options.receive_dir = arguments
                    .next()
                    .context("--receive-dir needs a directory")?
                    .into()
            }
            "--monitor" => {
                options.monitor = arguments
                    .next()
                    .context("--monitor needs a zero-based index")?
                    .parse()?
            }
            "--port" => {
                options.network.port = arguments
                    .next()
                    .context("--port needs a UDP port")?
                    .parse()?
            }
            _ => bail!("Unknown option: {argument}"),
        }
    }
    tokio::runtime::Runtime::new()?.block_on(async move {
        let (events, mut receiver) = mpsc::unbounded_channel();
        let stop = CancellationToken::new();
        let factory = native::factory(options.monitor);
        let mut task = tokio::spawn(session::host(options, factory, events, stop.clone()));
        loop {
            tokio::select! {
                result = &mut task => return result?,
                _ = tokio::signal::ctrl_c() => { stop.cancel(); return task.await?; }
                event = receiver.recv() => match event {
                    Some(HostEvent::Ready(invite)) => println!("V1 host ready. Invite:\n{invite}"),
                    Some(HostEvent::Connected { peer, .. }) => println!("Connected: {peer}"),
                    Some(HostEvent::Disconnected(message)) => println!("Disconnected: {message}"),
                    Some(HostEvent::Transfer(event)) => println!("File {}: {} / {}", event.name, event.bytes, event.total),
                    Some(HostEvent::Error(message)) => eprintln!("{message}"),
                    Some(HostEvent::Request { .. }) => unreachable!("Unattended hosts only accept trusted devices"),
                    Some(HostEvent::Stopped) | None => {},
                }
            }
        }
    })
}
