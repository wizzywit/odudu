---
title: Upgrading
description: Move a running Odudu server to a newer version, safely and one instance at a time.
---

# Upgrading

You will replace the running Odudu container with one from a newer image. Migrations run when the new server starts, so the database changes the moment it boots. Plan for a short stop, take a backup first, and check the new version answers before you call it done.

Odudu has no rolling upgrade yet. A rolling upgrade needs more than one instance running at once, and Odudu runs one ([Scaling](./scaling.md), and [many instances on the roadmap](../roadmap.md#later)). Expect the server to be unavailable from the moment you stop the old container until the new one answers.

## 1. Take a backup

The migrations only go forward. Odudu has no down migrations, so the way back from a bad upgrade is the backup you took beforehand. Follow [Backups](./backups.md) and keep the dump beside the version it came from.

## 2. Read what changed

Read the notes of every release between your version and the new one on [the releases page](https://github.com/wizzywit/odudu/releases), or in `CHANGELOG.md` in the repository. The phase notes in its `docs/phases` directory go into more detail. Look there for any command to run after the upgrade. Two you may meet:

- `odudu console provision`, after a version that changes the console's key or the base address, so each tenant registers the console's current key and redirect addresses. It also gives every existing tenant the roles a version added, such as `view-domains` and `manage-domains`; until it runs, those tenants' administrators are refused the routes behind them, and the console hides the area. A tenant made after the upgrade has them already. The command needs `ODUDU_CONSOLE` on. A deployment that runs with the console off has no admin client and no such roles, so it has nothing to upgrade.
- `odudu client-origins rebuild`, once, after upgrading past the migration that added client origins, so a client whose addresses use an internationalised host or an IPv6 literal is not refused its preflight.

## 3. Replace the container

Stop the old container before you start the new one. Migrations run at start in every process and take no lock, so two servers starting together would race. Then start the image tag you chose, with the same environment as before.

```text
docker pull ghcr.io/wizzywit/odudu:<new version>
```

Stop the old container, then start a new one from that tag. The server logs `migrations applied` when it has finished changing the database, and then listens.

## 4. Check it

Ask the new server for its version and whether it is ready. Run these in the folder that holds your compose file if you use one; with a plain `docker run`, run the first inside the container with `docker exec`.

```sh {run}
docker compose exec odudu odudu --version
```

```sh {run expect="database"}
curl -fsS "${ODUDU_BASE:-http://localhost:3000}/health/ready"
```

Then sign in to the console and open a tenant. A server that is ready but cannot sign anyone in is the case this last check catches.

## If it goes wrong

Stop the new container, restore the backup into a fresh database, and start the old image against it. Restoring is the part [Backups](./backups.md) says has not yet been proven by the project, so try it once on a scratch database before you depend on it.
