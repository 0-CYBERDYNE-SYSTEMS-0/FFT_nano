# Telegram Group Approval Implementation Notes

## 2026-05-19

- Decision: keep `TELEGRAM_AUTO_REGISTER` for known main/private bootstrap cases, but stop it from registering non-main Telegram groups. Unknown Telegram groups now always go through explicit approval so owners stay in control.
- Decision: use Telegram inline keyboards and callback queries through the existing settings-panel token registry. Telegram's current bot docs recommend inline keyboards for behind-the-scenes actions and editing the message after state changes, which matches the existing panel system.
- Decision: persist approval state in `data/telegram_group_approvals.json` rather than `groups/` or git-tracked files. This is runtime/operator state, not release content.
- Decision: unknown group messages are still not stored as chat history before approval. The host only stores chat metadata, creates a pending approval record, replies in the group with a clear waiting message, and notifies the main Telegram chat.
- Tradeoff: pending notifications to the main chat are throttled per group for 10 minutes to avoid panel spam. The group still gets a direct response when it addresses the bot so users do not experience silence.
- Tradeoff: the `/groups` command is now main/admin-only because the panel exposes group registration controls and chat identifiers.
- Change: the legacy Admin Panel `Groups` button now opens the same group-management panel instead of sending static text.
- Change: approval creates the same folder shape as Telegram auto-registration (`telegram-<chat id>`) and sends a confirmation into the approved group.
- Change: added `groups/testrun_aborted_*/` to `.gitignore` because the local test/runtime harness can create those folders and they should not become release artifacts.
