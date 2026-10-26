# BMD Auto Fill Usage

## Platform Support

This project is macOS-only. It uses Apple Events / `osascript` to execute JavaScript in the active Google Chrome tab.

`bmd-autofill-v1.mjs` fills BMDWeb week time entries from the active Google Chrome tab.

## Requirements

- Node.js available on your machine.
- Google Chrome with `View > Developer > Allow JavaScript from Apple Events` enabled.
- BMDWeb already open and logged in in the active Chrome tab.

Before running with `--save`, select the BMDWeb tab in Chrome's front window.
The script runs in that window's active tab; it does not search other tabs for
BMD or validate the URL/domain. It identifies the timesheet by its page controls.

For v1, start on the timesheet, the BMD main screen with the visible `TIME` tile,
or the TIME module screen with the visible `Edit` tile. The script navigates through
`TIME` > `Edit` automatically and waits for the timesheet before filling entries.
On other pages, open the timesheet manually if those tiles are unavailable.

V1 uses fixed times and the manually supplied `--tet`; it does not check Wi-Fi SSIDs
or macOS activity logs. TET entry is confirmed with Enter, followed by a pause,
then Tab and another pause before filling the times. It does not click dropdown
options. Increase `--delay` (for example, `--delay 1800`) if BMD responds slowly.

## Dry Run

Run without `--save` first. This prints the entries that would be created.

```sh
./bmd-autofill-v1.mjs --from 08:00 --until 17:00 --reason " " --tet 1
```

## Edit Individual Days In The Terminal

Add `--interactive` to open the entire plan in the nano terminal editor, one line
per day. Edit times, TET and quoted reasons together. Keep dates unchanged; delete
a line to skip that day. Times must use `HH:MM`, and Until must be later than From.
Save with Ctrl+O, Enter, then close with Ctrl+X. Delete all entry lines to cancel.
Invalid entries reopen the editor with an error comment for correction.

```text
19.10.2026 08:00 17:00 16 " "
20.10.2026 08:30 16:45 1 "Office"
```

```sh
./bmd-autofill-v1.mjs --week 2026-10-19 --from 08:00 --until 17:00 --tet 16 --interactive
```

The revised plan is printed to the console. Without `--save`, nothing is sent to
BMD and edits are not stored after the command exits. To edit and save in one
run, use `--interactive --save`; the edited per-day times are sent to BMD after
the editor closes. Interactive mode requires a terminal and `/usr/bin/nano`.

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
- `--interactive`: Edit the whole plan in nano before printing or saving.
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

## Outlook

A possible future enhancement is to extract Wi-Fi connection events from macOS
logs using configured office and home network names (SSIDs). These events could
suggest a start time and help distinguish office days (`TET 1`) from home-office
days (`TET 16`). Wi-Fi departure events could be combined with laptop lid-close
events to suggest an end time.

These suggestions would still need review: macOS may redact network names, logs
may be incomplete, and being connected to Wi-Fi does not necessarily mean working.
Ambiguous days should remain editable rather than receive guessed times. This
is an exploration for future development; v1 uses manually supplied times and TET.
