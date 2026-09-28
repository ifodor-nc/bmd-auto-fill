# BMD Auto Fill Usage

`bmd-autofill-v1.mjs` fills BMDWeb week time entries from the active Google Chrome tab.

## Requirements

- Node.js available on your machine.
- Google Chrome with `View > Developer > Allow JavaScript from Apple Events` enabled.
- BMDWeb already open and logged in in the active Chrome tab.

## Dry Run

Run without `--save` first. This prints the entries that would be created.

```sh
./bmd-autofill-v1.mjs --from 08:00 --until 17:00 --reason " " --tet 1
```

## Save Entries

Add `--save` when the dry-run plan looks correct.

```sh
./bmd-autofill-v1.mjs --from 08:00 --until 17:00 --reason " " --tet 1 --save
```

## Options

- `--from HH:MM`: Start time. Default: `08:00`.
- `--until HH:MM`: End time. Default: `17:00`.
- `--reason TEXT`: Reason text. Default: a single whitespace.
- `--tet NUMBER`: Time entry type / TET no. Default: `1`.
- `--days LIST`: Days to fill. Default: `mon,tue,wed,thu,fri`.
- `--week YYYY-MM-DD`: Any date in the target week. Default: today.
- `--delay MS`: Wait between BMDWeb actions. Default: `1200`.
- `--save`: Actually click Save for each day.
- `--help`: Show command help.

## Examples

Fill Monday through Friday for the current week:

```sh
./bmd-autofill-v1.mjs --from 08:00 --until 17:00 --reason " " --tet 1 --save
```

Fill Monday through Friday as home office:

```sh
./bmd-autofill-v1.mjs --from 08:00 --until 17:00 --reason " " --tet 16 --save
```

Fill only Monday, Wednesday, and Friday:

```sh
./bmd-autofill-v1.mjs --days mon,wed,fri --from 08:00 --until 17:00 --reason " " --tet 1 --save
```

Fill a specific week by passing any date in that week:

```sh
./bmd-autofill-v1.mjs --week 2026-06-08 --from 08:00 --until 17:00 --reason " " --tet 1 --save
```
