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
| `USAGE_HASH_SECRET` | Deployment-specific usage pseudonymization secret |
| `MENU_CACHE_MS` | `300000` (5 minutes) |

For a shared deployment, always set a private `USAGE_HASH_SECRET`.

## Notes

- The browser version remembers only the email and leaves password storage to the browser's password manager. The Electron desktop app stores both using the operating system's encrypted credential facility.
- Login sessions are kept only in memory and expire after 30 minutes of inactivity by default.
- After login, the app automatically shows wallet balance and upcoming orders from today onward.
- Upcoming orders show the ordered item and price.
- Upcoming orders can be cancelled from the app when the cafeteria provides a cancel link.
- Pick one meal per date, then use `Place selected orders`.
- Orders use the default delivery time `11:30 - 11:55`.
- Multi-date selections are submitted as separate cafeteria checkouts, one per date.
- The browser asks for confirmation before a real cafeteria order is submitted.
- Repeated requests with the same operation ID return the original result instead of placing a duplicate order.
- Usage records are pseudonymized, rotated by size, and deleted after the configured retention period.
