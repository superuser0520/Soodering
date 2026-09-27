# SooDering

This is a local ordering helper for `https://ssip-cafeteria.whew.life/lunch/`.
It shows every available lunch date in one screen, lets you pick meals across
multiple dates, and can submit the selected reservations through the cafeteria site.

## Run

```sh
npm start
```

Then open:

```text
http://localhost:3000
```

If port 3000 is already being used:

```sh
PORT=3001 npm start
```

Then open `http://localhost:3001`.

Run the desktop app with encrypted operating-system credential storage:

```sh
npm run electron
```

## Verify

```sh
npm run ci
npm audit --audit-level=high
```

GitHub Actions runs these checks for every pull request and every push to `main`.

## Configuration

Copy `.env.example` to `.env`, edit the values, and restart SooDering. Settings can also be supplied directly as environment variables:

| Variable | Default |
| --- | --- |
| `HOST` | `127.0.0.1` |
| `PORT` | `3000` |
| `SESSION_IDLE_TIMEOUT_MS` | `1800000` (30 minutes) |
| `MONTHLY_CREDIT` | `100` |
| `DEFAULT_TIME_SLOTS` | Comma-separated cafeteria time slots |
| `HIDDEN_MENU_ITEMS` | `vegetarian set,economic rice set,nasi padang set` |
| `PUBLIC_HOLIDAYS` | Comma-separated ISO dates |
| `USAGE_ADMIN_EMAIL` | Owner account |
| `USAGE_LOG_MAX_BYTES` | `2097152` (2 MB) |
| `USAGE_LOG_RETENTION_DAYS` | `30` |
| `MENU_CACHE_MS` | `300000` (5 minutes) |
| `MENU_LOOKAHEAD_MONTHS` | `1` additional calendar month checked beyond the dropdown's starting month |
| `EXTENDED_MENU_CACHE_MS` | `21600000` (6 hours) |
| `MENU_FETCH_CONCURRENCY` | `3` concurrent date requests |

## Notes

- Select Auto login before signing in to return without entering credentials again in the same browser. It works over a local network and survives server restarts. The browser holds an HttpOnly token; cafeteria credentials are encrypted in the server data folder. Returning renews the one-year token. Explicitly signing out disables Auto login; inactivity does not. Clearing browser cookies or server data requires signing in again. Electron also supports operating-system-encrypted credential storage.
- Login sessions are kept only in memory and expire after 30 minutes of inactivity by default.
- After login, the app automatically shows wallet balance and upcoming orders from today onward.
- The menu homepage shows today’s cafeteria order for the currently signed-in user.
- Upcoming orders show the ordered item and price.
- Upcoming orders can be cancelled from the app when the cafeteria provides a cancel link.
- Pick one meal per date, then use `Place selected orders`.
- Quick Halal Weekday chooses Malay first, then International for each unordered weekday. Quick Non Halal Order chooses Chinese first, then International, then Malay. Both keep the configured meal exclusions and show the actual stall and meal before confirmation. These names select stall priorities; the app does not verify individual meals' halal certification.
- The owner account (Soo Lih Jing, `soolihjing@shimano.com.sg` by default) can manage ordering restrictions in the Usage tab. Enter a name or email fragment and click Save restriction; matching is case-insensitive. Each saved restriction appears in a list with a Restore access button. Matching users see only "Request access usage from the admin." when attempting to order. The owner is exempt.
- Restrictions persist in `data/order-restrictions.json` on the running server and apply to each date of background jobs. They apply only to that server; independent desktop installations do not share restriction lists. A checkout already submitted cannot be undone by adding a restriction.
- Set `SOODEERING_DATA_DIR` to an absolute writable folder to keep runtime data outside the checkout, for example when running as a service. The default is the repository's `data` folder. Saving errors are shown in the admin editor.
- Orders use the default delivery time `11:30 - 11:55`.
- Multi-date selections are submitted as separate cafeteria checkouts, one per date.
- The background queue checks existing orders before submitting each date. Temporary errors retry up to three attempts with short delays; permanent failures such as insufficient funds or restricted access are not repeatedly submitted. Retry failed dates starts a fresh job for the unsuccessful dates and verifies them again first. Jobs for the same account run sequentially.
- A successful checkout stays successful even if refreshing account data fails. A lost or unreadable checkout response is checked against cafeteria orders and marked Check orders if it cannot be confirmed; it is not blindly resubmitted. Pending checkout markers persist in `data/pending-checkouts` across server restarts until the order can be confirmed. Do not delete these markers to force a retry without checking with the cafeteria.
- The browser asks for confirmation before a real cafeteria order is submitted.
- Repeated requests with the same operation ID return the original result instead of placing a duplicate order.
- Usage records show the cafeteria display name, rotate by size, and are deleted after the configured retention period.
- Menu discovery checks direct future date URLs instead of relying only on the cafeteria dropdown. Published results are cached separately, missing dates retry after five minutes, and the page automatically follows background updates. Manual refresh immediately retries every direct date.
