# AI The Route

Claude Code с вашей собственной подпиской Claude через шлюз AI The Route.
[English below](#english)

## Запуск

- **macOS и Linux:** откройте Терминал, наберите `sh ` (с пробелом), перетащите
  в окно файл `start.sh` из этой папки и нажмите Enter.
- **Windows:** дважды щёлкните `start.cmd`.

Скрипт попросит команду или ссылку из сообщения бота
[@aitheroute_bot](https://t.me/aitheroute_bot): вставьте её и нажмите Enter.
Остальное он сделает сам: поставит Node.js и Claude Code, если их нет, запишет
настройки и откроет вход в ваш аккаунт Claude. Права администратора не нужны.

Для входа нужен Google Chrome, Chromium или Microsoft Edge на macOS, Google
Chrome или Microsoft Edge на Windows, системный Chromium на Linux. На
Linux-сервере без рабочего стола сначала выполните настройку на своём Mac или
Windows, а на сервере вставьте токен входа, когда скрипт попросит. Повторный
запуск обновит Claude Code, если его поставил скрипт, и сохранит рабочий вход.

Через AI The Route работает Claude Code в терминале, в том числе в терминале
VS Code, Cursor и JetBrains. Приложение Claude Desktop идёт мимо: оно
подключается к Anthropic напрямую с вашего адреса, поэтому для работы через
AI The Route им не пользуйтесь.

## Что где лежит

Всё хранится в папке `.aitheroute` в вашей домашней папке:

| Что | Зачем |
| --- | --- |
| `start.sh`, `start.cmd` | запустить ещё раз: новый токен из бота, повторный вход |
| `setup/` | установщик (открытый код, его можно прочитать) |
| `helper/` | помощник входа в аккаунт Claude |
| `node/`, `claude/` | Node.js и Claude Code, если их не было на компьютере |
| `login/`, `profiles/` | данные помощника входа |
| `env.sh` | ваши настройки (macOS и Linux), доступны только вам |
| `guard.json` | что включила защита от протечек, если вы её включали |

В `~/.zshrc`, `~/.bashrc` или `~/.profile` добавляется блок
`# >>> AI The Route >>>` из одной строки, которая подгружает `env.sh`.
В Windows настройки хранятся в переменных среды пользователя.

## Защита от протечек

По желанию. В конце установки скрипт спросит, включить ли её, а потом её можно
включать и выключать в любой момент:

- macOS и Linux: `sh ~/.aitheroute/start.sh protect on` (или `off`, `status`);
- Windows, в PowerShell: `~\.aitheroute\start.cmd protect on` (в командной
  строке cmd: `%USERPROFILE%\.aitheroute\start.cmd protect on`).

Защита делает две вещи:

1. Адрес шлюза записывается в настройки самого Claude Code
   (`~/.claude/settings.json`), поэтому он ходит через AI The Route, даже если
   терминал или редактор не подхватил настройки. Перекрыть это могут только
   настройки конкретного проекта или параметры запуска. Права администратора
   не нужны.
2. Если согласитесь, прямые адреса Anthropic (claude.ai, api.anthropic.com и
   другие) закрываются для всех программ через файл `hosts`: приложение
   Claude Desktop и сайт claude.ai в обычном браузере перестанут открываться.
   Нужны права администратора: на macOS и Linux система спросит пароль, на
   Windows попросит подтвердить. Вход через помощника работает как прежде.
   Справка, поддержка и сайт claude.com остаются открыты.

`protect off` убирает обе части; если блок в `hosts` был, снова понадобятся
права администратора. Пока защита включена, автообновление Claude Code
выключено: тот, что поставил AI The Route, обновляется повторным запуском
`start`, а свой обновите после `protect off`.

## Как удалить

Если включали защиту от протечек, сначала выключите её (`protect off`, см.
выше). Потом удалите папку `.aitheroute`: без неё блок в файле терминала ничего не делает,
его можно стереть позже. В Windows удалите ещё переменные
`ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`,
`CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL` и запись
`C:\Users\<имя>\.aitheroute\claude` (`%USERPROFILE%\.aitheroute\claude`) в
`Path`, если скрипт ставил Claude Code, в окне «Переменные среды».

Вопросы: бот → «Помощь».

---

## English

Claude Code with your own Claude subscription, through the AI The Route gateway.

- **macOS and Linux:** open Terminal, type `sh ` (with a space), drag `start.sh`
  from this folder into the window and press Enter.
- **Windows:** double-click `start.cmd`.

It asks for the command or link from the [@aitheroute_bot](https://t.me/aitheroute_bot)
message; paste it and press Enter. It then installs Node.js and Claude Code if
they are missing, saves the settings and opens the sign-in to your Claude
account. No administrator rights are needed.

The sign-in needs Google Chrome, Chromium or Microsoft Edge on macOS, Google
Chrome or Microsoft Edge on Windows, the system's Chromium on Linux. On a Linux
server without a desktop, run the setup on your Mac or Windows computer first
and paste its sign-in token on the server when asked. Running it again updates
the Claude Code it installed and keeps a sign-in that works.

AI The Route serves Claude Code in a terminal, including the terminal inside
VS Code, Cursor and JetBrains IDEs. The Claude Desktop app goes around it: it
connects to Anthropic directly from your own address, so do not use it for work
through AI The Route.

Everything lives in `.aitheroute` in your home folder (`setup/` is the
installer, `helper/` the sign-in helper, `node/` and `claude/` only if they were
missing, `env.sh` your settings, readable by you alone). Your shell's startup
file gets a one-line `# >>> AI The Route >>>` block that loads `env.sh`; on
Windows the settings are user environment variables.

The leak guard is optional: the setup asks at the end, and it can be turned on
and off at any time with `sh ~/.aitheroute/start.sh protect on` (or `off`,
`status`) on macOS and Linux, `~\.aitheroute\start.cmd protect on` in Windows
PowerShell (`%USERPROFILE%\.aitheroute\start.cmd protect on` in cmd). It writes
the gateway's address into Claude Code's own settings
(`~/.claude/settings.json`), so Claude Code goes through AI The Route even where
a terminal or an editor has not loaded the settings (only a project's own
settings or launch options can override it); and, if you agree and grant
administrator rights (a password on macOS and Linux, a confirmation on
Windows), it closes Anthropic's direct addresses (claude.ai, api.anthropic.com
and others) to every program through the hosts file, so the Claude Desktop app
and claude.ai in your usual browser stop opening. The sign-in through the
helper works as before; docs, support and claude.com stay open. `protect off`
undoes both. While it is on, Claude Code's auto-update is off: the one AI The
Route installed updates when you run `start` again; update your own after
`protect off`.

To remove it all, turn the leak guard off first if you turned it on, then delete
that folder; on Windows also the user variables `ANTHROPIC_BASE_URL`,
`ANTHROPIC_CUSTOM_HEADERS`, `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and
`CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL`, and the
`C:\Users\<you>\.aitheroute\claude` entry (`%USERPROFILE%\.aitheroute\claude`)
in `Path`, there if it installed Claude Code.
