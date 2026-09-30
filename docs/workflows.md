# What this plugin can drive

The weather plugin itself does **one** thing: it turns a place into current conditions
and a forecast, through three faces.

| Face | What consumes it |
|---|---|
| `get_weather` tool | The model, in any Session. |
| `weather` Cordis service | Any other Host plugin — `service.forecast(...)`, `service.search(...)`. |
| The panel | You, looking at the sidebar. |

Everything below is built by **combining it with other DSH parts**, not by the plugin
alone. This file records which combinations actually exist today, because several
obvious ones are blocked by version or transport gaps rather than by anything missing
in this plugin.

## 1. Scheduled self-reminders — works today

`@deepseek-ai/dsh-schedule` ships inside DSH. It delivers due occurrences as
**follow-up messages in the Session that created them**, persists across restarts, and
supports one-shot, fixed-rate, daily, weekly, and five-field cron rules.

The shipped Web composition carries no `schedule` row, so enable it first: **Plugins →
Official → `@deepseek-ai/dsh-experimental-schedule-bundle`**, or list that bundle in
the profile's `dsh.profile.bundles`.

Then a Session can hold a standing weather brief, created once:

```
每天 07:30 用「杭州」查天气，只回一句：今天要不要带伞、穿什么。
```

which the model turns into

```json
{
  "title": "杭州晨间天气",
  "prompt": "用 get_weather 查杭州今天的天气，只回一句：今天要不要带伞、穿什么。",
  "daily": { "time": "07:30:00", "time_zone": "Asia/Shanghai" }
}
```

**The honest limit:** delivery lands in that Session's transcript. If you are not
looking at DSH, the reminder is waiting there rather than reaching your phone.

## 2. Real push to your phone — needs a small companion plugin

Every channel that can actually reach a phone from a Chinese network takes the same
shape: an HTTPS endpoint you POST JSON to. No inbound port, no reverse proxy, no
service review:

| Channel | Endpoint | Reaches |
|---|---|---|
| WeChat Work group robot | `qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…` | A WeChat Work group (a personal WeChat can join one) |
| DingTalk group robot | `oapi.dingtalk.com/robot/send?access_token=…` | A DingTalk group |
| Feishu group robot | `open.feishu.cn/open-apis/bot/v2/hook/…` | A Feishu group |
| Server酱 / PushPlus | `sctapi.ftqq.com/…`, `www.pushplus.plus/…` | Your personal WeChat |
| Telegram bot | `api.telegram.org/bot<token>/sendMessage` | A Telegram chat |

DSH has no outbound-notification plugin of its own — `@deepseek-ai/dsh-webhook` is
**inbound** (external event → new Session). But a Host plugin can simply `fetch()` such
an endpoint, which is what a ~150-line companion plugin would do:

```js
export const name = 'weather-push'
export const inject = ['weather', 'tools', 'schedule']

export function apply(ctx) {
  // 1. register a `push_weather` tool that reads ctx.weather and POSTs to your webhook
  // 2. optionally register a schedule row that fires it without a Session in the loop
}
```

Both dependencies already exist: `ctx.weather` is provided by this plugin, and
`ctx.schedule` by the bundle above. This is the honest answer to "remind me on
WeChat" — it needs code, but not much, and it needs no platform approval.

## 3. QQ bot — blocked by a version gap, not by this plugin

`@zaofan/dsh-qqbot` is the DSH QQ Bot channel. It is installed in the `web` profile but
**deliberately absent from that profile's `dsh.profile.bundles`**, because DSH refuses
to compose it:

```
dsh: skipping profile bundle "@zaofan/dsh-qqbot": Plugin @zaofan/dsh-qqbot@1.5.5 is
incompatible with dsh 0.2.0-rc.2: peerDependencies
{"@deepseek-ai/dsh-tools":"^0.1.1-rc.2"}.
```

That is not staleness on your side: **every published version through 1.5.19 still
declares `@deepseek-ai/dsh-tools: ^0.1.1-rc.2`**, while the installed runtime provides
`0.2.0-rc.2`. DSH also warns that running it anyway "may cause crashes or data loss",
so forcing it with an exact-version exemption is not a recommendation.

Even once compatible, note the direction: the QQ bot is a **channel**, so it answers
messages sent *to* it. Asking it for weather already works through `get_weather`.
Pushing weather *to* a QQ group unprompted is case 2 with QQ's API in place of a
webhook, and needs a QQ Bot AppID/Secret plus a send call.

## 4. Other combinations worth knowing

| Idea | Built from | Status |
|---|---|---|
| Umbrella alert before you leave | schedule + `get_weather` | works, arrives in-Session |
| Compare two cities you travel between | panel city chips, or two tool calls | works |
| Trip packing list | `get_weather` + a plain prompt | works |
| Bad-weather-day branch in a job | any Host plugin reading `ctx.weather` | works, needs code |
| Weather for a place named in a file/issue | `get_weather` + files/scripts | works |
| Push to phone on a schedule | case 2 | needs a small plugin |
| Push into QQ / personal WeChat group | QQ: version-blocked; WeChat: case 2 via a Work group robot | mixed |

## What this plugin does *not* do

* No alerting, thresholds, or background polling — it answers when asked.
* No outbound messaging of any kind.
* No offline cache or historical archive; a failed request shows a retry.
* No per-Session weather state: the panel's city list lives in the browser.
