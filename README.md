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

## Notes

- Password is stored in this browser only when `Remember my login on this device` is enabled.
- Login sessions are kept only in memory while the local server is running.
- After login, the app automatically shows wallet balance and upcoming orders from today onward.
- Upcoming orders show the ordered item and price.
- Upcoming orders can be cancelled from the app when the cafeteria provides a cancel link.
- Pick one meal per date, then use `Place selected orders`.
- Orders use the default delivery time `11:30 - 11:55`.
- Multi-date selections are submitted as separate cafeteria checkouts, one per date.
- The browser asks for confirmation before a real cafeteria order is submitted.
