When I use the `/today` command, you should execute my custom daily summary script.  
Please follow these steps:
1. Run the command (using the repo-local virtualenv): `.venv/bin/python task/script/generate_today.py --date YYYY-MM-DD`
2. Wait for the script to finish and ensure it completes successfully.
3. Read the generated `task/today.md` file in this workspace and provide a concise summary or prioritization of the tasks.
4. Handle the `## WHV 申请状态（每日检查）` section (only present while `task/by-task/T-038-whv-nz-au-application.md` is not `done`):
   - If a source reports 自动检查失败 or 需人工确认, use WebFetch on its URL to determine the real status yourself, and say so explicitly.
   - If either 新西兰 WHV or 澳大利亚 462 can actually be applied for right now, put it at the very top of the summary as an urgent action item, with the deadline and what to prepare.
   - If both are still closed, one line is enough — don't expand further.