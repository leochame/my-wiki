# Rust Remote Office V1

Rust 远程办公程序，项目版本 `1.0.0`，协议固定为 `rust-remote-office/1`，邀请格式固定为 `rro1:`。所有端点使用同一套 V1 实现。

## 当前功能

- Windows 与 macOS 的控制端、被控端；Linux 控制端。
- P2P 加密连接、纯直连、公共或自定义中继。
- 屏幕无损分块更新、画面确认、采集节奏调整、控制流优先级。
- 独立的采集/编码与输入工作线程，客户端在线程池解压和重建画面。
- 键鼠、中文文本、组合键、Cmd/Ctrl 映射、文本剪贴板。
- 多显示器切换、1–60 次/秒目标更新频率、暂停、最小化暂停、100%/150%/200% 缩放、全屏。
- 双向文件发送、拖入文件上传、按远端路径下载、进度和 BLAKE3 校验。
- 受信设备持久化、授权撤销、预先授权后的无人值守连接。
- 同一会话自动重连；固定设备身份和被控端端口。
- 用户设置、启动应用时自动分享、无界面的常驻被控模式。
- 直连/中继路径、RTT、画面接收速率、实际更新频率和处理耗时。

实现与验证状态见 [PROGRESS.md](PROGRESS.md)。

## 启动

需要 Rust 1.95+ 和本机编译工具。

```sh
cargo run --release --locked
```

Windows 使用 Rust MSVC 工具链，并安装 Visual Studio Build Tools 的 C++ 桌面开发组件。macOS 要求 14+，安装 Xcode Command Line Tools；ScreenCaptureKit 依赖会编译其系统桥接代码。

macOS 打包：

```sh
bash scripts/package-macos.sh
open "dist/Rust Remote Office.app"
```

分享 Mac 时需在系统设置中授予屏幕录制与辅助功能权限。仅作为控制端不会初始化本机采集后端。

## 两台设备连接

1. 被控端可先 **Load displays** 选择显示器，然后 **Start sharing**。
2. **Copy invite**，通过你已有的渠道将 `rro1:` 邀请发送给控制端。
3. 控制端填写设备名、粘贴邀请，选择键鼠及文件权限，点击 **Connect**。
4. 被控端核对弹窗中的设备身份，选择允许的权限，点击 **Allow connection**。
5. 点击远程画面后操作；工具栏可切屏、调整目标更新频率、暂停、缩放和全屏。
6. **Disconnect** 结束连接，**Stop sharing** 停止分享。临时授权在本次分享期间支持网络中断后的自动重连；停止分享结束这次临时授权。

初始邀请有效期为十分钟。已授权的同一会话重连使用设备身份确认；明确的拒绝、撤销授权和停止分享会结束自动重试。网络中断最多自动重试五次，重试间隔为 1、2、4、8、8 秒。同一已授权设备重新连接可以替换旧连接，避免等待旧连接超时。

## 文件传输

打开 **Files**：输入本地文件路径并 **Send file**，或将文件拖入窗口。控制端与被控端均可主动发送文件；两种角色同时运行时，默认发送到当前查看的电脑。

控制端还可以填写远端文件路径并 **Download file**。例如 Windows 的 `C:\Users\Name\Desktop\report.docx`，或 macOS 的 `/Users/name/Desktop/report.docx`。

文件保存到对端配置的接收目录，默认是用户下载目录下的 `Rust Remote Office`。已存在的同名文件会报告错误，不会覆盖。传输完成后校验内容，再公布收到的文件。连接中断会清理未完成的临时文件，文件需要重新发送。

接收目录在新连接时生效。文件权限独立于键鼠权限；允许文件传输意味着允许通过文件接口发送文件和读取远端用户可访问的文件。

## 无人值守与常驻

首次在被控端确认连接时勾选 **Trust this device for unattended access**。以后该设备凭固定的密钥身份连接，使用已经批准的权限。

在 **Trusted devices** 可以查看权限和 **Forget device**；撤销会结束该设备的活动连接。默认键鼠与文件请求均可由被控端分别批准。

勾选 **Start sharing when app opens** 并 **Save settings**，下次打开应用时自动开始分享。也可以关闭图形界面后运行常驻模式：

```sh
cargo run --release --locked -- --host
```

可指定参数：

```sh
cargo run --release --locked -- --host --port 44124 --monitor 0 --receive-dir "/path/to/received"
cargo run --release --locked -- --host --relay --relay-url "https://relay.example.com/"
```

常驻模式只接受已经配对的受信设备，不弹出连接确认；使用前先在图形界面完成配对和系统授权。终端会输出本次邀请，Ctrl+C 停止分享。

被控端默认固定 UDP 端口 `44124`，可在设置或 `--port` 中修改。身份和端口保持不变且网络地址仍可达时，受信设备可以在被控端程序重启后使用已有邀请连接。地址变化后应复制当前邀请；中继模式也取决于对应服务的可达性。

V1 的无人值守面向已经登录的用户桌面。系统登录界面、Windows UAC 安全桌面及系统级后台服务不在当前实现范围内。

## 连接模式

**Use relay assistance** 关闭时，只使用直接地址，不配置公共地址发布与查询，适合局域网或公网可达地址。

打开时使用 iroh 公共中继；填写 **Relay URL** 可改用自己的中继服务。连接建立后尝试直连，不能直连时使用中继。网络与中继配置错误会直接报告。

## 配置位置

- Windows：`%APPDATA%/RustRemoteOffice/`
- macOS：`~/Library/Application Support/RustRemoteOffice/`
- Linux：`$XDG_CONFIG_HOME/rust-remote-office/`，未设置时为 `~/.config/rust-remote-office/`

`identity.key` 保存本机身份，`trusted.json` 保存受信设备和权限，`settings.json` 保存设置。它们位于操作系统用户目录，不写入本 Vault。Unix 身份文件以仅当前用户可读写的权限创建。

## 验证

```sh
cargo test --locked --no-default-features
cargo clippy --locked --all-targets -- -D warnings
cargo build --locked
cargo fmt --all -- --check
cargo run --locked -- --version
cargo run --locked -- --help
```

核心测试在真实的本机加密连接上使用模拟桌面，包含文件实际读写、自动重连、设备授权持久化与撤销、多屏切换、暂停以及采集繁忙时的输入处理。当前环境为 Linux；Mac/Windows 的原生构建、系统授权、录屏和实际输入仍待真机验证，公网穿透与中继切换也未实测。

V1 使用无损分块截图传输，默认目标为每秒 8 次更新；工具栏设置的是目标上限，实际频率由采集、压缩与网络共同决定。音频、硬件视频编码、文件断点续传和 Linux 被控后端尚未实现。

## Sources

- `rust-remote-office/src/protocol.rs`
- `rust-remote-office/src/session.rs`
- `rust-remote-office/src/capture.rs`
- `rust-remote-office/src/files.rs`
- `rust-remote-office/src/config.rs`
- [iroh](https://docs.rs/iroh/1.4.1/iroh/)
- [ScreenCaptureKit Rust 接口](https://docs.rs/screencapturekit/11.1.2/screencapturekit/)
