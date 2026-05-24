# Яндекс-реклама — интеграция (Судоку Классик)

Игра использует глобальный синглтон `window.AdManager` из [ads.js](../ads.js), который определяет backend **лениво** при первом показе:

| Backend | Условие | Когда применяется |
|---|---|---|
| `native` | `window.YandexAds.showInterstitial` существует | Production APK (html2apk c `-YandexAdsBridge`) |
| `mock` | `window.YandexAds` отсутствует или `Storage.getMockAds()/CFG.mockAds` принудительно true | dev в браузере |

Никакой веб-SDK слой (`Ya.Context.AdvManager.render`, РСЯ `context.js`) **не подключается** — проект целится только в РуСтор APK.

## Слоты рекламы

| Слот | Когда показывается | Метод | unit-ID |
|---|---|---|---|
| **Interstitial** | Перед началом нового уровня после клика «Начать», если выполнены условия cadence | `AdManager.showInterstitialAd()` | `GAME_CONFIG.ADS.interstitial.unitId` |
| **Rewarded** | По кнопке «Восстановить за рекламу (+1 ♥)» в модалке game-over | `AdManager.showRewardedAd(reward)` | `GAME_CONFIG.ADS.rewarded.unitId` |

Точки вызова — [main.js](../main.js): обработчик `#btn-start-level` (interstitial) и `#btn-gameover-ad` (rewarded).

**Каденс interstitial:**
- Первые `ADS.interstitial.skipFirstNLevels` пройденных уровней (по умолчанию 2) — без рекламы.
- Дальше — после каждого N-го пройденного уровня, где N = `ADS.interstitial.cadenceLevels` (по умолчанию 2).
- Минимальный cooldown между показами — `ADS.interstitial.cooldownMs` (по умолчанию 90 сек).

Unit-ID в [config.js](../config.js):
- Interstitial: `R-M-XXXXXXXX-1` (placeholder, заменить перед публикацией)
- Rewarded: `R-M-XXXXXXXX-2` (placeholder, заменить перед публикацией)

Источник реальных ID: [Yandex Partner Mobile Ads](https://partner.yandex.ru/mobile-ads).

## Сборка APK с включённым Yandex Mobile Ads

```powershell
& "$env:LOCALAPPDATA\Programs\html2apk\html2apk.ps1" `
  -ProjectFolder "C:\Users\Александр\Desktop\Claude\06_Sudoku" `
  -AppName "Судоку Классик" `
  -AppId "com.terekh.sudoku" `
  -OutputFile "$env:USERPROFILE\Downloads\SudokuClassic.apk" `
  -YandexAdsBridge `
  -RuStoreReviewSdk
```

html2apk автоматически добавляет gradle-зависимость, `ACCESS_NETWORK_STATE`, `YandexAdsBridge.java` и патчит MainActivity. Параметры из `.claude/build-config.json` подхватываются по умолчанию — `-AppName`/`-AppId` указывать необязательно если они там корректные.

## Контракт callback'ов от Java

```js
window.__yandexAdsCallback(kind, event)
// kind:  'interstitial' | 'rewarded'
// event: 'closed' | 'rewarded'
```

- `interstitial` всегда завершается событием `closed`.
- `rewarded` приходит с `rewarded`, если пользователь досмотрел до конца; иначе `closed` (награда не выдаётся).

Имя callback'а зафиксировано в Java-классе `YandexAdsBridge`.

## Mock backend (dev)

В браузере без bridge'а `ads.js` рисует HTML-оверлей `.ad-mock-overlay` (динамически создаваемый, см. [styles.css](../styles.css)) с прогресс-баром и автозакрытием через 1.2–1.6 сек.

`AdManager.showInterstitialAd()` → `{ watched: true }` после закрытия оверлея.
`AdManager.showRewardedAd(reward)` → `{ watched: true, reward }` (mock всегда даёт reward).

## Проверка backend

В DevTools-консоли:
```js
AdManager.getBackend()  // 'native' | 'mock' | 'pending'
AdManager.stats()       // { totalShown, backend, lastInterstitialAt }
```

## Dev-panel override

В [devPanel.js](../devPanel.js) есть кнопка «Toggle Mock Ads», она дёргает `Storage.setMockAds(!current)`. После переключения нужна **перезагрузка страницы** — backend определяется один раз при загрузке.

## Где смотреть в коде

- Backend detection: [ads.js](../ads.js) → `ensureBackend()`.
- Native bridge logic: [ads.js](../ads.js) → `showInterstitialAd()` / `showRewardedAd()` (ветка `if (backend === 'native')`).
- Mock fallback: [ads.js](../ads.js) → `showMockOverlay()`.
- Каденс: [ads.js](../ads.js) → `shouldShowInterstitial()`.
- Триггеры: [main.js](../main.js) — обработчики `#btn-start-level` и `#btn-gameover-ad`.
