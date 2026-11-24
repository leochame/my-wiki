When I use the `/today` command, you should execute my custom daily summary script.  
Please follow these steps:
1. Run the command via the Terminal panel (`mcp__terminal__run_in_terminal`), **not** via Bash — the Bash sandbox blocks outbound network, which silently breaks the Gmail / blog / WHV fetches:
   `.venv/bin/python task/script/generate_today.py --date YYYY-MM-DD`
   Fall back to Bash only if the terminal is unavailable, and say so if the fetch sections come back empty.
2. Wait for the script to finish and ensure it completes successfully.
3. Read the generated `task/today.md` file in this workspace and provide a concise summary or prioritization of the tasks.
4. Handle the `## WHV 申请状态（每日检查）` section (only present while `task/by-task/T-038-whv-nz-au-application.md` is not `done`):
   - If a source reports 自动检查失败 or 需人工确认, verify it yourself with WebFetch on the URL and say so explicitly.
   - If either 新西兰 WHV or 澳大利亚 462 can actually be applied for right now, put it at the very top of the summary as an urgent action item, with the deadline and what to prepare.
   - If both are still closed, one line is enough — don't expand further.
5. Handle the `## 今日金融订阅资讯（核心财经 / 监管 / 机构）` section:
   - Summarize the key takeaways from my financial subscriptions in Chinese under 4 concise headings: 宏观与央行/监管动向、市场与科技主线、重点风险信号、今日必读原文（3–5 篇带原文链接）。
   - Ground every point strictly in the headlines/summaries listed in `task/today.md` without fabricating numbers or prices.