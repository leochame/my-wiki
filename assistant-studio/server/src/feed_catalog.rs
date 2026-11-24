/// Curated thematic taxonomy and Chinese descriptions for Andrej Karpathy's
/// 91-blog reading list (HN 2025 OPML), organized into 5 clear technical/essay
/// categories instead of a single standalone "Karpathy" bucket.
pub const KARPATHY_FEED_DIRECTORY: &[(&str, &str, &str)] = &[
    // ── 1. AI 与前沿研究 (10) ───────────────────────────────────────────────
    (
        "dwarkesh.com",
        "AI 与前沿研究",
        "Karpathy 关注 · Dwarkesh Patel：深度 AI / 科学与历史访谈播客（常对话一线实验室负责人）",
    ),
    (
        "gilesthomas.com",
        "AI 与前沿研究",
        "Karpathy 关注 · Giles Thomas：手写 GPT-2 / MoE / JAX 训练与大模型底层实验记录",
    ),
    (
        "minimaxir.com",
        "AI 与前沿研究",
        "Karpathy 关注 · Max Woolf：AI 工程实测、LLM 基准评测、Rust 性能与数据科学博客",
    ),
    (
        "geohot.github.io",
        "AI 与前沿研究",
        "Karpathy 关注 · George Hotz（tinygrad 创始人）：AI 芯片、编译器与深度学习基础设施随笔",
    ),
    (
        "gwern.net",
        "AI 与前沿研究",
        "Karpathy 关注 · Gwern Branwen：AI 扩展律、统计学、心理学与超长篇深度研究",
    ),
    (
        "garymarcus.substack.com",
        "AI 与前沿研究",
        "Karpathy 关注 · Gary Marcus：认知科学家，对大模型幻觉、AGI 与 AI 泡沫的批判性观察",
    ),
    (
        "borretti.me",
        "AI 与前沿研究",
        "Karpathy 关注 · Fernando Borretti：AI 安全、编程语言理论与形式化思考",
    ),
    (
        "wheresyoured.at",
        "AI 与前沿研究",
        "Karpathy 关注 · Ed Zitron：科技行业与 AI 商业周期、资本开支的犀利深度评论",
    ),
    (
        "geoffreylitt.com",
        "AI 与前沿研究",
        "Karpathy 关注 · Geoffrey Litt：AI 辅助编程、可塑软件（Malleable Software）与人机交互",
    ),
    (
        "worksonmymachine.substack.com",
        "AI 与前沿研究",
        "Karpathy 关注 · Scott Werner：AI 时代软件工程、前沿部署与新工具范式随笔",
    ),
    // ── 2. 系统与底层工程 (23) ──────────────────────────────────────────────
    (
        "antirez.com",
        "系统与底层工程",
        "Karpathy 关注 · Salvatore Sanfilippo（Redis 作者）：C/系统编程、分布式与 AI 对软件的影响",
    ),
    (
        "matklad.github.io",
        "系统与底层工程",
        "Karpathy 关注 · Aleksey Kladov（rust-analyzer / TigerBeetle）：Rust、编译器与系统架构",
    ),
    (
        "mitchellh.com",
        "系统与底层工程",
        "Karpathy 关注 · Mitchell Hashimoto（HashiCorp / Ghostty 创始人）：Zig、终端协议与现代基建",
    ),
    (
        "xania.org",
        "系统与底层工程",
        "Karpathy 关注 · Matt Godbolt（Compiler Explorer 作者）：C++、编译器优化、汇编与性能剖析",
    ),
    (
        "bernsteinbear.com",
        "系统与底层工程",
        "Karpathy 关注 · Max Bernstein：编译器、JIT、PyPy/RPython 与虚拟机实现",
    ),
    (
        "devblogs.microsoft.com/oldnewthing",
        "系统与底层工程",
        "Karpathy 关注 · Raymond Chen（微软资深工程师）：Windows 内核历史、Win32 与底层系统轶事",
    ),
    (
        "eli.thegreenplace.net",
        "系统与底层工程",
        "Karpathy 关注 · Eli Bendersky：编译器、Go/Python/C++、Lean 与算法深度教程",
    ),
    (
        "beej.us",
        "系统与底层工程",
        "Karpathy 关注 · Brian \"Beej\" Hall：经典网络编程与 C/Rust 底层教学指南作者",
    ),
    (
        "fabiensanglard.net",
        "系统与底层工程",
        "Karpathy 关注 · Fabien Sanglard：经典游戏引擎源码剖析、图形学与底层硬件技术",
    ),
    (
        "danielchasehooper.com",
        "系统与底层工程",
        "Karpathy 关注 · Daniel Chase Hooper：C/Swift 底层开发、实时编译可视化与工具链实验",
    ),
    (
        "michael.stapelberg.ch",
        "系统与底层工程",
        "Karpathy 关注 · Michael Stapelberg（i3wm / Debian 开发者）：Go SIMD、Linux 与高性能开源工具",
    ),
    (
        "it-notes.dragas.net",
        "系统与底层工程",
        "Karpathy 关注 · Stefano Marinelli：BSD / illumos / Linux 服务器架构与开源运维实践",
    ),
    (
        "rachelbythebay.com",
        "系统与底层工程",
        "Karpathy 关注 · Rachel Kroll：大厂基础设施一线故障排查与系统工程实战经验",
    ),
    (
        "utcc.utoronto.ca/~cks",
        "系统与底层工程",
        "Karpathy 关注 · Chris Siebenmann：Unix/Linux 运维、ZFS、网络与基础设施长期笔记",
    ),
    (
        "jeffgeerling.com",
        "系统与底层工程",
        "Karpathy 关注 · Jeff Geerling：树莓派、Ansible、Kubernetes 与自建家庭实验室运维",
    ),
    (
        "tedunangst.com",
        "系统与底层工程",
        "Karpathy 关注 · Ted Unangst（OpenBSD 开发者）：操作系统内核、安全与极简系统编程",
    ),
    (
        "lucumr.pocoo.org",
        "系统与底层工程",
        "Karpathy 关注 · Armin Ronacher（Flask / Sentry 作者）：Python/Rust 生态与 AI 工具链",
    ),
    (
        "miguelgrinberg.com",
        "系统与底层工程",
        "Karpathy 关注 · Miguel Grinberg：Python/Flask 后端开发、容器化与全职开源实践",
    ),
    (
        "martinalderson.com",
        "系统与底层工程",
        "Karpathy 关注 · Martin Alderson：Linux/systemd、后端性能与 Agent 工程提速",
    ),
    (
        "matduggan.com",
        "系统与底层工程",
        "Karpathy 关注 · Mat Duggan：ClickHouse、分布式存储与云原生后端工程",
    ),
    (
        "philiplaine.com",
        "系统与底层工程",
        "Karpathy 关注 · Philip Laine：Kubernetes、Docker 与云基础设施工程笔记",
    ),
    (
        "xeiaso.net",
        "系统与底层工程",
        "Karpathy 关注 · Xe Iaso：云原生、Rust/Go/Nix 与基础设施技术随笔",
    ),
    (
        "jayd.ml",
        "系统与底层工程",
        "Karpathy 关注 · Jayden：Linux / Arch 桌面折腾、音频与自托管工具脚本",
    ),
    // ── 3. 软件工程与开发生态 (19) ──────────────────────────────────────────
    (
        "overreacted.io",
        "软件工程与开发生态",
        "Karpathy 关注 · Dan Abramov（React / Bluesky 核心开发者）：前端架构、atproto 与软件抽象",
    ),
    (
        "buttondown.com/hillelwayne",
        "软件工程与开发生态",
        "Karpathy 关注 · Hillel Wayne：形式化方法（TLA+）、软件测试与软件工程实证研究",
    ),
    (
        "seangoedecke.com",
        "软件工程与开发生态",
        "Karpathy 关注 · Sean Goedecke：大厂工程文化、系统设计决策与技术领导力",
    ),
    (
        "entropicthoughts.com",
        "软件工程与开发生态",
        "Karpathy 关注 · kqr：软件工程方法论、代码评审、Stacked Diffs 与开发效率",
    ),
    (
        "nesbitt.io",
        "软件工程与开发生态",
        "Karpathy 关注 · Andrew Nesbitt：开源包管理器、供应链生态与版本控制周报",
    ),
    (
        "keygen.sh",
        "软件工程与开发生态",
        "Karpathy 关注 · Zeke Gabrielse（Keygen 创始人）：独立 SaaS 架构、软件授权系统与运维复盘",
    ),
    (
        "terriblesoftware.org",
        "软件工程与开发生态",
        "Karpathy 关注 · Matheus Lima：软件工程反模式、团队协作与 AI 时代工程师体验",
    ),
    (
        "refactoringenglish.com",
        "软件工程与开发生态",
        "Karpathy 关注 · Michael Lynch：软件设计文档、技术博客写作与独立开发经验",
    ),
    (
        "blog.jim-nielsen.com",
        "软件工程与开发生态",
        "Karpathy 关注 · Jim Nielsen：Web 平台演进、前端极简主义与界面设计思考",
    ),
    (
        "danieldelaney.net",
        "软件工程与开发生态",
        "Karpathy 关注 · Daniel Delaney：开发工具交互设计、UI 范式与软件产品评论",
    ),
    (
        "danielwirtz.com",
        "软件工程与开发生态",
        "Karpathy 关注 · Daniel Wirtz：生产力自动化、Home Assistant 与效率工具实践",
    ),
    (
        "evanhahn.com",
        "软件工程与开发生态",
        "Karpathy 关注 · Evan Hahn：Web 开发、极简工具与日常技术随笔",
    ),
    (
        "hugotunius.se",
        "软件工程与开发生态",
        "Karpathy 关注 · Hugo Tunius：软件开发、数据中心与技术趋势评论",
    ),
    (
        "idiallo.com",
        "软件工程与开发生态",
        "Karpathy 关注 · Ibrahim Diallo：软件工程师职场故事、数据安全与行业观察",
    ),
    (
        "jyn.dev",
        "软件工程与开发生态",
        "Karpathy 关注 · Jyn Nelson（Rustdoc 前维护者）：开源工具链、社区文化与技术反思",
    ),
    (
        "skyfall.dev",
        "软件工程与开发生态",
        "Karpathy 关注 · Skyfall：独立开发者与开源工程技术日志",
    ),
    (
        "tomrenner.com",
        "软件工程与开发生态",
        "Karpathy 关注 · Tom Renner：IndieWeb、开源信任链与软件生态观察",
    ),
    (
        "herman.bearblog.dev",
        "软件工程与开发生态",
        "Karpathy 关注 · Herman Martinus（Bear Blog 创始人）：极简 Web、独立产品与阅读思考",
    ),
    (
        "shkspr.mobi",
        "软件工程与开发生态",
        "Karpathy 关注 · Terence Eden：开放 Web 标准、开源协议与物联网折腾",
    ),
    // ── 4. 硬件、安全与极客逆向 (20) ────────────────────────────────────────
    (
        "krebsonsecurity.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Brian Krebs：全球知名网络安全调查记者，追踪勒索软件与网络犯罪",
    ),
    (
        "troyhunt.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Troy Hunt（Have I Been Pwned 创始人）：数据泄露分析与安全周报",
    ),
    (
        "brutecat.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Brutecat：Google/云服务高危漏洞挖掘与 AI 辅助安全研究",
    ),
    (
        "micahflee.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Micah Lee：隐私安全、开源加密工具与本地私有模型安全指南",
    ),
    (
        "lcamtuf.substack.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Michał Zalewski（AFL 模糊测试作者）：信息安全、硬件电子与跨学科随笔",
    ),
    (
        "blog.pixelmelt.dev",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Pixelmelt：Web/软件逆向工程、DRM 分析与强化学习趣味实验",
    ),
    (
        "timsh.org",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Tim Sh：反诈骗网络调查、自托管安全与 Web 隐私分析",
    ),
    (
        "maurycyz.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Maurycy Z：密码学、邮件协议自建与网络底层机制剖析",
    ),
    (
        "berthub.eu",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Bert Hubert（PowerDNS 创始人）：DNS/网络主权、数字政务安全与欧洲科技政策",
    ),
    (
        "mjg59.dreamwidth.org",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Matthew Garrett：Linux 内核安全、固件/UEFI 逆向与硬件安全",
    ),
    (
        "righto.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Ken Shirriff：经典 CPU/模拟芯片显微镜开盖逆向工程（8087、6502 等）",
    ),
    (
        "bogdanthegeek.github.io",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · BogdanTheGeek：嵌入式硬件黑客、RISC-V 调试器与微控制器折腾",
    ),
    (
        "downtowndougbrown.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Doug Brown：FPGA、嵌入式驱动修复与经典 Mac 硬件维护",
    ),
    (
        "ericmigi.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Eric Migicovsky（Pebble 创始人）：智能手表与极客消费硬件创业进展",
    ),
    (
        "abortretry.fail",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Bradford Morgan White：计算机发展史、经典硬件公司与微机考古",
    ),
    (
        "computer.rip",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Computer.rip：通信网络史、基础设施与早期计算机系统考据",
    ),
    (
        "oldvcr.blogspot.com",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Cameron Kaiser：复古电脑/主机硬件修复、PowerPC 与老式系统研究",
    ),
    (
        "dfarq.homeip.net",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Dave Farquhar：复古 PC 历史、操作系统演进与硬件回顾",
    ),
    (
        "filfre.net",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Jimmy Maher（The Digital Antiquarian）：计算机游戏史与早期软件文化编年史",
    ),
    (
        "aresluna.org",
        "硬件、安全与极客逆向",
        "Karpathy 关注 · Marcin Wichary：排版史、键盘/交互硬件设计与数字考古",
    ),
    // ── 5. 数学、科学与深度随笔 (19) ────────────────────────────────────────
    (
        "johndcook.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · John D. Cook：应用数学、数论、统计学与科学计算高频短文",
    ),
    (
        "chiark.greenend.org.uk/~sgtatham",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Simon Tatham（PuTTY 作者）：趣味数学、算法谜题、拼图几何与编程随笔",
    ),
    (
        "susam.net",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Susam Pal：数学趣味、早期计算机记忆与独立技术笔记",
    ),
    (
        "grantslatton.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Grant Slatton：算法博弈、系统思维与工程管理短篇洞察",
    ),
    (
        "construction-physics.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Brian Potter：建筑、制造、半导体与现代工业技术的第一性原理剖析",
    ),
    (
        "dynomight.net",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Dynomight：跨学科定量分析、心理测量、数学与社会现象实证随笔",
    ),
    (
        "experimental-history.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Adam Mastroianni：实验心理学、科学同行评审机制与学术文化犀利随笔",
    ),
    (
        "chadnauseam.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Chad Nauseam：生物医药、宏观经济与科学数据思考",
    ),
    (
        "paulgraham.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Paul Graham（YC 联合创始人）：创业方法论、创造力、超线性回报与人生随笔",
    ),
    (
        "steveblank.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Steve Blank（精益创业之父）：科技地缘政治、半导体竞争与创业战略",
    ),
    (
        "daringfireball.net",
        "数学、科学与深度随笔",
        "Karpathy 关注 · John Gruber：苹果生态、消费科技产品与硅谷行业评论",
    ),
    (
        "derekthompson.org",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Derek Thompson（《大西洋月刊》专栏）：经济趋势、人口、文化与科技社会",
    ),
    (
        "pluralistic.net",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Cory Doctorow：反垄断、平台「屎化」、版权与数字权利每日评论",
    ),
    (
        "anildash.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Anil Dash：互联网文化史、科技伦理与开放网络评论",
    ),
    (
        "tedium.co",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Ernie Smith：冷门科技与日常器物发展史长篇特稿",
    ),
    (
        "hey.paris",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Hey Paris：科技批判、公共基础设施与人文观察",
    ),
    (
        "rakhim.exotext.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Rakhim Davletkaliyev：软件文化、AI 与人类语言的哲学随笔",
    ),
    (
        "simone.org",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Simone Silvestroni：科技、商业本质与独立思考短文",
    ),
    (
        "joanwestenberg.com",
        "数学、科学与深度随笔",
        "Karpathy 关注 · Joan Westenberg：科技评论、创业与现代社会文化随笔",
    ),
];

/// Match a feed source against the curated Karpathy 91 directory.
pub fn classify_karpathy_source(
    name: &str,
    site_url: &str,
    feed_url: &str,
) -> Option<(&'static str, &'static str)> {
    let hay = format!(
        "{} {} {}",
        name.to_lowercase(),
        site_url.to_lowercase(),
        feed_url.to_lowercase()
    );
    for (key, group, desc) in KARPATHY_FEED_DIRECTORY {
        if hay.contains(key) {
            return Some((*group, *desc));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn karpathy_directory_has_all_91_and_no_karpathy_group() {
        assert_eq!(KARPATHY_FEED_DIRECTORY.len(), 91);
        for (domain, group, desc) in KARPATHY_FEED_DIRECTORY {
            assert!(!group.to_lowercase().contains("karpathy"), "group for {domain} should not be Karpathy");
            assert!(!desc.trim().is_empty(), "desc for {domain} should not be empty");
            let matched = classify_karpathy_source(domain, &format!("https://{domain}"), "");
            assert_eq!(matched, Some((*group, *desc)));
        }
    }
}
