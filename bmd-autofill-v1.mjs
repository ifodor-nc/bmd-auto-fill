#!/usr/bin/env node

import { execFileSync } from "node:child_process";

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
  --save             Actually click Save for each day.
  --help             Show this help.

Safety:
  Without --save this only prints the entries it would create.
  Chrome must have View > Developer > Allow JavaScript from Apple Events enabled.
  BMDWeb must already be open and logged in in the active Chrome tab.
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

console.log("BMDWeb week time-entry plan:");
for (const date of dates) {
    console.log(`- ${formatDmy(date)} ${config.from}-${config.until} tet=${config.tet} reason=${JSON.stringify(config.reason)}`);
}

if (!config.save) {
    console.log("\nDry run only. Re-run with --save to create and save the entries.");
    process.exit(0);
}

const browserConfig = {
    from: config.from,
    until: config.until,
    reason: config.reason,
    tet: config.tet,
    delay: config.delay,
    dates: dates.map(formatDmy),
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
    if (!/^\d{2}:\d{2}$/.test(value)) {
        throw new Error(`${flag} must use HH:MM, for example 08:00`);
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

    async function fillAndSaveDate(dmy) {
        await selectDate(dmy);
        clickByText("New");
        await sleep(cfg.delay);

        setInputValue(inputByName("MCA_ZBU_BUCHUNG_DATUM"), dmy);
        const tet = tetInput();
        if (!tet) {
            throw new Error("Could not find visible TET no. / time entry type input");
        }
        setInputValue(tet, cfg.tet);
        setInputValue(inputByName("MCA_ZBU_BUCHUNG_BEGINNZEIT"), cfg.from);
        setInputValue(inputByName("MCA_ZBU_BUCHUNG_ENDEZEIT"), cfg.until);
        setInputValue(inputByName("MCA_ZBU_BEGRUENDUNG"), cfg.reason);
        await sleep(Math.max(500, Math.floor(cfg.delay / 2)));

        const duration = inputByName("MCA_ZBU_BUCHUNGSDAUER").value;
        clickByText("Save");
        await sleep(cfg.delay);
        return { date: dmy, from: cfg.from, until: cfg.until, tet: cfg.tet, duration };
    }

    const results = [];
    for (const dmy of cfg.dates) {
        results.push(await fillAndSaveDate(dmy));
    }

    return JSON.stringify({ saved: results });
}());
`;
}
