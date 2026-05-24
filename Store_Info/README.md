# Store_Info — материалы для публикации в РуСтор

Эта папка содержит ВСЁ, что нужно для отправки APK в магазин:

| Файл / папка | Назначение | Что нужно сделать перед публикацией |
|---|---|---|
| `keystore/` | Подпись APK (release.jks + конфиг). **Один общий keystore на все игры Александра** — не пересоздавать. | Ничего, уже готов. |
| `icon.png` (1024×1024) | Иконка приложения. Подхватывается html2apk через `build-config.json → iconPath`. | Заменить placeholder на финальный арт перед релизом. |
| `store-icon.png` (512×512) | Иконка для **карточки в магазине** (грузится в RuStore Console). | Заменить placeholder. |
| `store-feature.png` (1024×500) | Опциональный баннер карточки в RuStore Console. | Заменить placeholder или удалить если не нужен. |
| `screenshots/01..05.jpg` (1080×1920) | Скриншоты на странице магазина (4-8 шт.). | Заменить placeholder на реальный gameplay. |
| `STORE_LISTING.md` | Описание для RuStore Console (короткое+полное, теги, email). | Копируешь руками в RuStore Console при загрузке. |
| `PRIVACY_POLICY.md` | Источник правды текста политики конфиденциальности. | Обновляешь только при изменении SDK / сбора данных. |
| `PRIVACY_POLICY.pdf` | PDF-экспорт `.md` для облачного хостинга. | Регенерируется из `.md` через Edge headless при изменении. |

## Хостинг политики конфиденциальности

РуСтор **требует** URL политики при наличии рекламы (у нас Yandex Mobile Ads → обязательно).

1. Сгенерируй PDF из `.md` (если ещё не сделано или текст менялся):
   ```powershell
   & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
     --headless --print-to-pdf="$PWD\PRIVACY_POLICY.pdf" `
     "file:///$PWD/PRIVACY_POLICY.md"
   ```
2. Загрузи `PRIVACY_POLICY.pdf` на одно из:
   - Cloud Mail.ru (cloud.mail.ru) — связан с почтой terekh-spb@mail.ru
   - Yandex Disk (disk.yandex.ru)
   - Google Drive (drive.google.com)
3. Получи **публичную ссылку** на файл (не на папку).
4. Впиши URL в `STORE_LISTING.md` → раздел «Базовая информация → Политика конфиденциальности».

## Email поддержки

`terekh-spb@mail.ru` (личный, не рабочий matryoshka.com).

## Checklist перед первой публикацией

- [ ] Реальные unit-IDs Yandex Mobile Ads вписаны в `../config.js` (interstitial + rewarded).
- [ ] `icon.png` (1024) — финальный арт, не placeholder.
- [ ] `store-icon.png` (512) — финальный арт.
- [ ] `screenshots/` — реальный gameplay (минимум 4 штуки).
- [ ] `STORE_LISTING.md` — `privacyUrl` заполнен.
- [ ] `PRIVACY_POLICY.pdf` залит на облако, URL живой.
- [ ] Запущен skill `prepare-release-candidate` — собрался RC APK.
- [ ] APK прошёл smoke-test на физическом устройстве.
