#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_DAYS = "mon,tue,wed,thu,fri";
const DAY_INDEX = new Map([
    ["mon", 0],
    ["monday", 0],
    ["tue", 1],
    ["tuesday", 1],
    ["wed", 2],
    ["wednesday", 2],
    ["thu", 3],
    ["thursday", 3],
    ["fri", 4],
    ["friday", 4],
    ["sat", 5],
    ["saturday", 5],
    ["sun", 6],
    ["sunday", 6],
]);

const usage = `Usage:
  ./bmd-autofill-v1.mjs --from 08:00 --until 17:00 --reason " " [--tet 1] [--save]

Options:
  --from HH:MM       Start time. Default: 08:00
  --until HH:MM      End time. Default: 17:00
  --reason TEXT      Required reason. Default: single whitespace
  --tet NUMBER       Time entry type / TET no. Default: 1
                     Examples: 1=Normal Booking, 16=Homeoffice
  --days LIST        Days to fill. Default: ${DEFAULT_DAYS}
                     Example: mon,tue,wed,thu,fri
  --week YYYY-MM-DD  Any date in the target week. Default: today
  --delay MS         Wait between BMDWeb actions. Default: 1200
  --interactive      Edit the whole plan at once in the nano terminal editor.
  --save             Actually click Save for each day.
  --help             Show this help.

Safety:
  Without --save this only prints the entries it would create.
  Chrome must have View > Developer > Allow JavaScript from Apple Events enabled.
  BMDWeb must already be open and logged in in the active Chrome tab.
  Start on the timesheet, the main screen with TIME, or the TIME module with Edit.
  The script navigates through TIME > Edit when needed.
`;

const config = parseArgs(process.argv.slice(2));
const dates = getWeekDates(config.week).filter((_, index) => config.days.includes(index));

if (config.help) {
    console.log(usage);
    process.exit(0);
}

if (dates.length === 0) {
    throw new Error("No matching days selected. Check --days.");
}

const entries = dates.map((date) => ({
    date: formatDmy(date), from: config.from, until: config.until,
    tet: config.tet, reason: config.reason,
}));
if (config.interactive) {
    if (await editEntries(entries) === false) process.exit(0);
}

console.log("BMDWeb week time-entry plan:");
for (const entry of entries) {
    console.log(`- ${entry.date} ${entry.from}-${entry.until} tet=${entry.tet} reason=${JSON.stringify(entry.reason)}`);
}

if (!config.save) {
    console.log("\nDry run only. Re-run with --save to create and save the entries.");
    process.exit(0);
}

const browserConfig = {
    delay: config.delay,
    entries,
};

const injectedScript = buildBrowserScript(browserConfig);
const appleScript = [
    'tell application "Google Chrome"',
    `execute active tab of front window javascript ${JSON.stringify(injectedScript)}`,
    "end tell",
].join("\n");

const result = execFileSync("osascript", ["-e", appleScript], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
});

console.log(result.trim());

function parseArgs(args) {
    const parsed = {
        from: "08:00",
        until: "17:00",
        reason: " ",
        tet: "1",
        days: parseDays(DEFAULT_DAYS),
        week: new Date(),
        delay: 1200,
        save: false,
        interactive: false,
        help: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        switch (arg) {
            case "--from":
                parsed.from = requireValue(args, ++index, arg);
                break;
            case "--until":
                parsed.until = requireValue(args, ++index, arg);
                break;
            case "--reason":
                parsed.reason = requireValue(args, ++index, arg);
                break;
            case "--tet":
                parsed.tet = requireTet(requireValue(args, ++index, arg));
                break;
            case "--days":
                parsed.days = parseDays(requireValue(args, ++index, arg));
                break;
            case "--week":
                parsed.week = parseIsoDate(requireValue(args, ++index, arg));
                break;
            case "--delay":
                parsed.delay = Number.parseInt(requireValue(args, ++index, arg), 10);
                if (!Number.isFinite(parsed.delay) || parsed.delay < 250) {
                    throw new Error("--delay must be an integer >= 250");
                }
                break;
            case "--save":
                parsed.save = true;
                break;
            case "--interactive":
                parsed.interactive = true;
                break;
            case "--help":
            case "-h":
                parsed.help = true;
                break;
            default:
                throw new Error(`Unknown option: ${arg}\n\n${usage}`);
        }
    }

    assertTime(parsed.from, "--from");
    assertTime(parsed.until, "--until");
    return parsed;
}

function requireTet(value) {
    if (!/^\d+$/.test(value)) {
        throw new Error("--tet must be a positive integer, for example 1 or 16");
    }
    return value;
}

function requireValue(args, index, flag) {
    if (index >= args.length || args[index].startsWith("--")) {
        throw new Error(`${flag} requires a value`);
    }
    return args[index];
}

function assertTime(value, flag) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new Error(`${flag} must use HH:MM, for example 08:00`);
    }
}

async function editEntries(entries) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error("--interactive requires a terminal. Run this command directly in Terminal.");
    }
    const directory = mkdtempSync(join(tmpdir(), "bmd-plan-"));
    const file = join(directory, "plan.txt");
    const header = "# Date        From  Until TET Reason (quoted JSON string)\n"
        + "# Edit times, TET and reason. Keep dates unchanged; remove a line to skip it.\n"
        + "# Save: Ctrl+O, Enter. Close: Ctrl+X. Empty plan cancels.\n";
    writeFileSync(file, header + entries.map((entry) =>
        `${entry.date} ${entry.from} ${entry.until} ${entry.tet} ${JSON.stringify(entry.reason)}`
    ).join("\n") + "\n", { mode: 0o600 });
    try {
        while (true) {
            execFileSync("/usr/bin/nano", [file], { stdio: "inherit" });
            try {
                const seen = new Set();
                const edited = readFileSync(file, "utf8").split(/\r?\n/)
                    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
                    .map((line) => {
                        const match = line.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
                        if (!match) throw new Error("Use: date from until TET \"reason\"");
                        const [, date, from, until, tet, reasonText] = match;
                        if (!entries.some((entry) => entry.date === date) || seen.has(date)) {
                            throw new Error("Unknown or duplicate date: " + date);
                        }
                        seen.add(date);
                        assertTime(from, "From");
                        assertTime(until, "Until");
                        if (until <= from) throw new Error(date + ": Until must be later than From.");
                        requireTet(tet);
                        const reason = JSON.parse(reasonText);
                        if (typeof reason !== "string") throw new Error("Reason must be a quoted string.");
                        return { date, from, until, tet, reason };
                    });
                if (!edited.length) {
                    console.log("Empty plan. Cancelled without changing BMD.");
                    return false;
                }
                entries.splice(0, entries.length, ...edited);
                break;
            } catch (error) {
                const contents = readFileSync(file, "utf8");
                writeFileSync(file, "# ERROR: " + error.message.replace(/[\r\n]/g, " ") + "\n" + contents);
            }
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function parseDays(value) {
    return value
        .split(",")
        .map((day) => day.trim().toLowerCase())
        .filter(Boolean)
        .map((day) => {
            if (!DAY_INDEX.has(day)) {
                throw new Error(`Unknown day '${day}'. Use values like mon,tue,wed,thu,fri.`);
            }
            return DAY_INDEX.get(day);
        });
}

function parseIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("--week must use YYYY-MM-DD");
    }
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function getWeekDates(anchor) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);

    return Array.from({ length: 7 }, (_, index) => {
        const weekDate = new Date(date);
        weekDate.setDate(date.getDate() + index);
        return weekDate;
    });
}

function formatDmy(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}.${month}.${date.getFullYear()}`;
}

function buildBrowserScript(browserConfig) {
    return `
(async function () {
    const cfg = ${JSON.stringify(browserConfig)};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (el) => Boolean(el && el.offsetParent !== null);

    function textOf(el) {
        return (el.innerText || el.value || el.title || el.getAttribute("aria-label") || "").trim();
    }

    function extComponentForInput(input) {
        if (!window.Ext || !input.id || !input.id.endsWith("-inputEl")) {
            return null;
        }
        return window.Ext.getCmp(input.id.replace("-inputEl", ""));
    }

    function key(input, name, code, keyCode) {
        input.dispatchEvent(new KeyboardEvent("keydown", {
            key: name,
            code,
            keyCode,
            which: keyCode,
            bubbles: true,
        }));
        input.dispatchEvent(new KeyboardEvent("keyup", {
            key: name,
            code,
            keyCode,
            which: keyCode,
            bubbles: true,
        }));
    }

    function setInputValue(input, value) {
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        const component = extComponentForInput(input);
        if (component && component.setValue) {
            component.setValue(value);
            if (component.fireEvent) {
                component.fireEvent("change", component, value);
            }
        }

        input.blur();
    }

    async function setTetValue(input, value) {
        const component = extComponentForInput(input);
        input.focus();
        input.select?.();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        if (component) {
            if (component.setRawValue) {
                component.setRawValue(value);
            }
            if (component.setValue) {
                component.setValue(value);
            }
            if (component.fireEvent) {
                component.fireEvent("change", component, value);
            }
        }

        input.dispatchEvent(new Event("change", { bubbles: true }));
        key(input, "Enter", "Enter", 13);
        await sleep(Math.max(750, Math.floor(cfg.delay / 2)));
        key(input, "Tab", "Tab", 9);
        await sleep(Math.max(1000, cfg.delay));
    }

    function inputByName(name) {
        const input = [...document.querySelectorAll("input")]
            .find((candidate) => visible(candidate) && candidate.name === name);
        if (!input) {
            throw new Error("Could not find visible input: " + name);
        }
        return input;
    }

    function inputByNames(names) {
        return [...document.querySelectorAll("input")]
            .find((candidate) => visible(candidate) && names.includes(candidate.name));
    }

    function inputByNearbyText(patterns) {
        const labels = [...document.querySelectorAll("label,td,th,span,div")]
            .filter((candidate) => visible(candidate) && patterns.some((pattern) => pattern.test(textOf(candidate))));

        for (const label of labels) {
            let container = label;
            for (let depth = 0; depth < 5 && container; depth += 1) {
                const input = [...container.querySelectorAll("input")]
                    .find((candidate) => visible(candidate) && candidate.type !== "hidden");
                if (input) {
                    return input;
                }
                container = container.parentElement;
            }
        }

        return null;
    }

    function inputByExtFieldLabel(patterns) {
        if (!window.Ext || !window.Ext.ComponentQuery) {
            return null;
        }

        const fields = window.Ext.ComponentQuery.query("field")
            .filter((field) => field && patterns.some((pattern) => pattern.test(field.fieldLabel || field.boxLabel || field.name || "")));

        for (const field of fields) {
            const input = field.inputEl && field.inputEl.dom;
            if (visible(input)) {
                return input;
            }
        }

        return null;
    }

    function tetInput() {
        const names = [
            "MCA_ZBU_ZBUCHARTNR",
            "MCA_ZBU_TET_NR",
            "MCA_ZBU_TET_NO",
            "MCA_ZBU_TET",
            "MCA_ZBU_ZEITART",
            "MCA_ZBU_ZEITART_NR",
            "MCA_ZBU_BUCHUNGSART",
            "MCA_ZBU_BUCHUNGSART_NR",
        ];
        const patterns = [/^TET\\s*no\\.?$/i, /time entry type/i, /zeit.*art/i, /buchungsart/i];

        return inputByNames(names)
            || inputByExtFieldLabel(patterns)
            || inputByNearbyText(patterns);
    }

    function exactTextElement(label) {
        return [...document.querySelectorAll("a,button,span,div")]
            .find((candidate) => visible(candidate) && textOf(candidate) === label);
    }

    function hasVisibleButton(label) {
        return Boolean(exactTextElement(label));
    }

    function hasVisibleInputName(name) {
        return [...document.querySelectorAll("input")]
            .some((candidate) => visible(candidate) && candidate.name === name);
    }

    function hasVisibleDatePicker() {
        return [...document.querySelectorAll("input")]
            .some((candidate) =>
                visible(candidate)
                && /^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(candidate.value)
                && candidate.name !== "MCA_ZBU_BUCHUNG_DATUM"
            );
    }

    function isTimesheetPage() {
        return hasVisibleButton("New")
            && hasVisibleDatePicker()
            && (
                hasVisibleInputName("MCA_ZBU_BUCHUNG_BEGINNZEIT")
                || /Time entries/i.test(document.body.innerText || "")
            );
    }

    function tileButton(label) {
        const directTile = [...document.querySelectorAll("a.bmd-tile[role='button'],a[role='button'],button")]
            .find((candidate) => visible(candidate) && textOf(candidate) === label);
        if (directTile) {
            return directTile;
        }

        const exact = exactTextElement(label);
        if (!exact) {
            return null;
        }

        return exact.closest("a.bmd-tile[role='button'],a[role='button'],button")
            || exact.closest("a,button")
            || null;
    }

    function timeTile() {
        return tileButton("TIME");
    }

    function editTile() {
        return tileButton("Edit");
    }

    async function waitForNavigationStep(predicate, errorMessage) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            if (predicate()) {
                return;
            }
            await sleep(500);
        }

        throw new Error(errorMessage);
    }

    async function openEditTile() {
        const tile = editTile();
        if (!tile) {
            throw new Error("Could not find the BMD TIME module Edit tile. Open the timesheet manually and retry.");
        }

        tile.click();
        await waitForNavigationStep(
            isTimesheetPage,
            "Clicked Edit, but the BMD timesheet page did not appear within 15 seconds.",
        );
        await sleep(cfg.delay);
    }

    async function ensureTimesheetPage() {
        if (isTimesheetPage()) {
            return "already-on-timesheet";
        }

        if (editTile()) {
            await openEditTile();
            return "navigated-from-edit-tile";
        }

        const tile = timeTile();
        if (!tile) {
            throw new Error("Could not find the timesheet page or the BMD main-screen TIME tile. Open the timesheet manually and retry.");
        }

        tile.click();
        await waitForNavigationStep(
            () => isTimesheetPage() || Boolean(editTile()),
            "Clicked TIME, but neither the BMD Edit tile nor the timesheet page appeared within 15 seconds.",
        );

        if (isTimesheetPage()) {
            await sleep(cfg.delay);
            return "navigated-from-time-tile";
        }

        await openEditTile();
        return "navigated-from-time-edit-tiles";
    }

    function clickByText(label) {
        const candidates = [...document.querySelectorAll("a,button,span,div")]
            .filter((candidate) => visible(candidate) && textOf(candidate) === label);
        const target = candidates
            .map((candidate) => candidate.closest("a,button") || candidate)
            .find(visible);
        if (!target) {
            throw new Error("Could not find visible button: " + label);
        }
        target.click();
    }

    async function selectDate(dmy) {
        const dateInput = [...document.querySelectorAll("input")]
            .find((candidate) =>
                visible(candidate)
                && /^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(candidate.value)
                && candidate.name !== "MCA_ZBU_BUCHUNG_DATUM"
            );
        if (!dateInput) {
            throw new Error("Could not find the page date input for " + dmy);
        }

        setInputValue(dateInput, dmy);
        dateInput.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
        }));
        dateInput.dispatchEvent(new KeyboardEvent("keyup", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
        }));
        await sleep(cfg.delay);
    }

    async function fillAndSaveDate(entry) {
        const dmy = entry.date;
        await selectDate(dmy);
        clickByText("New");
        await sleep(cfg.delay);

        setInputValue(inputByName("MCA_ZBU_BUCHUNG_DATUM"), dmy);
        const tet = tetInput();
        if (!tet) {
            throw new Error("Could not find visible TET no. / time entry type input");
        }
        await setTetValue(tet, entry.tet);
        setInputValue(inputByName("MCA_ZBU_BUCHUNG_BEGINNZEIT"), entry.from);
        setInputValue(inputByName("MCA_ZBU_BUCHUNG_ENDEZEIT"), entry.until);
        setInputValue(inputByName("MCA_ZBU_BEGRUENDUNG"), entry.reason);
        await sleep(Math.max(500, Math.floor(cfg.delay / 2)));

        const duration = inputByName("MCA_ZBU_BUCHUNGSDAUER").value;
        clickByText("Save");
        await sleep(cfg.delay);
        return { date: dmy, from: entry.from, until: entry.until, tet: entry.tet, duration };
    }

    const navigation = await ensureTimesheetPage();
    const results = [];
    for (const entry of cfg.entries) {
        results.push(await fillAndSaveDate(entry));
    }

    return JSON.stringify({ navigation, saved: results });
}());
`;
}
