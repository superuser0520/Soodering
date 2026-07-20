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

## Raspberry Pi service

SooDering can run headlessly on a Raspberry Pi as a Node.js service. Use a 64-bit Raspberry Pi OS image and Node.js 22 or newer.

### SSH into the Pi

Find the Pi address from your router, or run this from another machine on the same network if mDNS is enabled:

```sh
ssh pi@raspberrypi.local
```

If you know the IP address:

```sh
ssh pi@192.168.1.50
```

### Install and launch

On the Pi:

```sh
sudo apt update
sudo apt install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/superuser0520/Soodering.git ~/Soodering
cd ~/Soodering
npm ci --omit=dev
HOST=0.0.0.0 PORT=3000 npm start
```

Open `http://<pi-ip-address>:3000` from a browser on the same network.

### Run as a systemd service

The repository includes `deployment/soodering.service`. If your Pi login user is not `pi`, edit the `User`, `WorkingDirectory`, and `ExecStart` paths in the service file before installing it.

```sh
sudo mkdir -p /var/lib/soodering
sudo chown pi:pi /var/lib/soodering
sudo cp ~/Soodering/deployment/soodering.service /etc/systemd/system/soodering.service
sudo systemctl daemon-reload
sudo systemctl enable --now soodering
sudo systemctl status soodering
```

Useful service commands:

```sh
sudo journalctl -u soodering -f
sudo systemctl restart soodering
sudo systemctl stop soodering
```

To update later:

```sh
cd ~/Soodering
git pull
npm ci --omit=dev
sudo systemctl restart soodering
```

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
