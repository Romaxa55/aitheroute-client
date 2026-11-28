# Security

Found a vulnerability in the setup, the sign-in helper or the gateway they talk
to? Please do not open a public issue. Write to us privately instead:

- through the Telegram bot [@aitheroute_bot](https://t.me/aitheroute_bot):
  **Help** → **Write to support**;
- or through GitHub's **Report a vulnerability** button on this repository's
  Security tab.

Say what you found, how to reproduce it and what it affects. Never send a real
token or sign-in token: a description, or a token you have already reissued, is
enough. We reply as soon as we can and say when a fix is out.

In scope: everything in this repository and the gateway's routes it uses
(`/i/…`, `/setup/…`, the helper's pairing and route checks). Out of scope:
Anthropic's and other providers' own services, and attacks that need access to
your computer or your Telegram account.

When you test, use only your own token, and do not run load or
denial-of-service tests.

## Безопасность

Нашли уязвимость в настройке, помощнике входа или шлюзе, к которому они
обращаются? Пожалуйста, не открывайте публичный issue. Напишите нам напрямую:

- в Telegram-боте [@aitheroute_bot](https://t.me/aitheroute_bot):
  «Помощь» → «Написать в поддержку»;
- или кнопкой **Report a vulnerability** на вкладке Security этого
  репозитория.

Расскажите, что нашли, как это воспроизвести и на что это влияет. Никогда не
присылайте настоящий токен или токен входа: хватит описания или токена, который
вы уже перевыпустили. Мы ответим, как только сможем, и скажем, когда выйдет
исправление.

Входит в рамки: всё в этом репозитории и маршруты шлюза, которыми оно
пользуется (`/i/…`, `/setup/…`, привязка помощника и проверки маршрута). Не
входит: собственные сервисы Anthropic и других провайдеров, а также атаки,
которым нужен доступ к вашему компьютеру или аккаунту Telegram.

Проверяйте только со своим токеном; не устраивайте нагрузочных тестов и атак
на отказ в обслуживании.
