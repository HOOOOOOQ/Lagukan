const { readdirSync } = require("node:fs");
const path = require("node:path");
const { ApplicationCommandOptionType } = require("discord.js");

const DISCORD_LIMITS = Object.freeze({
    MIN_NAME_LENGTH: 1,
    MAX_NAME_LENGTH: 32,
    MIN_DESCRIPTION_LENGTH: 1,
    MAX_DESCRIPTION_LENGTH: 100,
    MAX_OPTIONS_PER_LEVEL: 25,
    MAX_CHOICES_PER_OPTION: 25,
    MIN_CHOICE_NAME_LENGTH: 1,
    MAX_CHOICE_NAME_LENGTH: 100,
    MIN_CHOICE_STRING_VALUE_LENGTH: 1,
    MAX_CHOICE_STRING_VALUE_LENGTH: 100,
});

const DISCORD_COMMAND_NAME_REGEX = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

function getOptionTypeLabel(type) {
    if (type === ApplicationCommandOptionType.Subcommand || type === 1) return "subcommand";
    if (type === ApplicationCommandOptionType.SubcommandGroup || type === 2) return "subcommand_group";
    return "option";
}

function validateLocalizationMap(localizations, maxAllowed, baseIssue, fieldLabel, issues) {
    if (!localizations || typeof localizations !== "object") return;

    for (const [locale, text] of Object.entries(localizations)) {
        if (text === null || text === undefined) continue;
        const str = String(text);
        if (str.length < 1 || str.length > maxAllowed) {
            issues.push({
                ...baseIssue,
                fieldPath: `${fieldLabel}[${locale}]`,
                actualLength: str.length,
                maxAllowed,
                valuePreview: str,
                reason:
                    str.length === 0
                        ? `Lokalisasi ${locale} tidak boleh kosong`
                        : `Panjang teks lokalisasi (${str.length}) melebihi batas maksimal Discord (${maxAllowed})`,
            });
        }
    }
}

function validateCommandOptionsRecursive(options, context, issues) {
    if (!Array.isArray(options)) return;

    const { commandIndex, commandName, sourceFile, parentPath } = context;

    if (options.length > DISCORD_LIMITS.MAX_OPTIONS_PER_LEVEL) {
        issues.push({
            commandIndex,
            commandName,
            sourceFile,
            fieldPath: `${parentPath}.options`,
            actualLength: options.length,
            maxAllowed: DISCORD_LIMITS.MAX_OPTIONS_PER_LEVEL,
            valuePreview: `${options.length} options`,
            reason: `Jumlah option (${options.length}) melebihi batas maksimal Discord (${DISCORD_LIMITS.MAX_OPTIONS_PER_LEVEL})`,
        });
    }

    const seenOptionNames = new Set();
    let seenOptionalValueOption = false;

    options.forEach((opt, optIdx) => {
        const optName = typeof opt?.name === "string" ? opt.name : "";
        const kindLabel = getOptionTypeLabel(opt?.type);
        const currentPath = `${parentPath}.options[${optIdx}] (${kindLabel}: ${optName || "tanpa_nama"})`;
        const baseIssue = { commandIndex, commandName, sourceFile };

        // 1. Option / Subcommand name check
        if (
            optName.length < DISCORD_LIMITS.MIN_NAME_LENGTH ||
            optName.length > DISCORD_LIMITS.MAX_NAME_LENGTH ||
            optName !== optName.toLowerCase() ||
            !DISCORD_COMMAND_NAME_REGEX.test(optName)
        ) {
            issues.push({
                ...baseIssue,
                fieldPath: `${currentPath}.name`,
                actualLength: optName.length,
                maxAllowed: DISCORD_LIMITS.MAX_NAME_LENGTH,
                valuePreview: optName,
                reason:
                    optName.length > DISCORD_LIMITS.MAX_NAME_LENGTH
                        ? `Panjang nama ${kindLabel} (${optName.length}) melebihi batas maksimal (${DISCORD_LIMITS.MAX_NAME_LENGTH})`
                        : `Nama ${kindLabel} harus huruf kecil 1-${DISCORD_LIMITS.MAX_NAME_LENGTH} karakter tanpa spasi`,
            });
        } else if (seenOptionNames.has(optName)) {
            issues.push({
                ...baseIssue,
                fieldPath: `${currentPath}.name`,
                actualLength: optName.length,
                maxAllowed: DISCORD_LIMITS.MAX_NAME_LENGTH,
                valuePreview: optName,
                reason: `Duplikasi nama ${kindLabel} "${optName}" pada level yang sama`,
            });
        } else {
            seenOptionNames.add(optName);
        }

        // 2. Option / Subcommand description check (1 - 100 chars)
        const optDesc = typeof opt?.description === "string" ? opt.description : "";
        if (optDesc.length < DISCORD_LIMITS.MIN_DESCRIPTION_LENGTH || optDesc.length > DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH) {
            issues.push({
                ...baseIssue,
                fieldPath: `${currentPath}.description`,
                actualLength: optDesc.length,
                maxAllowed: DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH,
                valuePreview: optDesc,
                reason:
                    optDesc.length === 0
                        ? `Deskripsi ${kindLabel} kosong (minimal ${DISCORD_LIMITS.MIN_DESCRIPTION_LENGTH} karakter)`
                        : `Deskripsi ${kindLabel} melebihi batas maksimal Discord (${optDesc.length}/${DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH} karakter)`,
            });
        }

        validateLocalizationMap(
            opt?.name_localizations || opt?.nameLocalizations,
            DISCORD_LIMITS.MAX_NAME_LENGTH,
            baseIssue,
            `${currentPath}.name_localizations`,
            issues,
        );
        validateLocalizationMap(
            opt?.description_localizations || opt?.descriptionLocalizations,
            DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH,
            baseIssue,
            `${currentPath}.description_localizations`,
            issues,
        );

        // 3. Required option ordering check (regular options only)
        const isSub = kindLabel === "subcommand" || kindLabel === "subcommand_group";
        if (!isSub) {
            if (opt?.required) {
                if (seenOptionalValueOption) {
                    issues.push({
                        ...baseIssue,
                        fieldPath: `${currentPath}.required`,
                        actualLength: optDesc.length,
                        maxAllowed: DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH,
                        valuePreview: optName,
                        reason: `Option wajib (required: true) harus diletakkan sebelum option opsional`,
                    });
                }
            } else {
                seenOptionalValueOption = true;
            }
        }

        // 4. Choices check
        if (Array.isArray(opt?.choices)) {
            if (opt.choices.length > DISCORD_LIMITS.MAX_CHOICES_PER_OPTION) {
                issues.push({
                    ...baseIssue,
                    fieldPath: `${currentPath}.choices`,
                    actualLength: opt.choices.length,
                    maxAllowed: DISCORD_LIMITS.MAX_CHOICES_PER_OPTION,
                    valuePreview: `${opt.choices.length} choices`,
                    reason: `Jumlah choices (${opt.choices.length}) melebihi batas maksimal (${DISCORD_LIMITS.MAX_CHOICES_PER_OPTION})`,
                });
            }

            opt.choices.forEach((choice, choiceIdx) => {
                const choiceName = typeof choice?.name === "string" ? choice.name : "";
                if (
                    choiceName.length < DISCORD_LIMITS.MIN_CHOICE_NAME_LENGTH ||
                    choiceName.length > DISCORD_LIMITS.MAX_CHOICE_NAME_LENGTH
                ) {
                    issues.push({
                        ...baseIssue,
                        fieldPath: `${currentPath}.choices[${choiceIdx}].name`,
                        actualLength: choiceName.length,
                        maxAllowed: DISCORD_LIMITS.MAX_CHOICE_NAME_LENGTH,
                        valuePreview: choiceName,
                        reason: `Panjang nama choice (${choiceName.length}) tidak sesuai batas Discord (1-${DISCORD_LIMITS.MAX_CHOICE_NAME_LENGTH} karakter)`,
                    });
                }

                if (typeof choice?.value === "string") {
                    if (
                        choice.value.length < DISCORD_LIMITS.MIN_CHOICE_STRING_VALUE_LENGTH ||
                        choice.value.length > DISCORD_LIMITS.MAX_CHOICE_STRING_VALUE_LENGTH
                    ) {
                        issues.push({
                            ...baseIssue,
                            fieldPath: `${currentPath}.choices[${choiceIdx}].value`,
                            actualLength: choice.value.length,
                            maxAllowed: DISCORD_LIMITS.MAX_CHOICE_STRING_VALUE_LENGTH,
                            valuePreview: choice.value,
                            reason: `Panjang value choice (${choice.value.length}) tidak sesuai batas Discord (1-${DISCORD_LIMITS.MAX_CHOICE_STRING_VALUE_LENGTH} karakter)`,
                        });
                    }
                }
            });
        }

        // 5. Nested options (subcommands / subcommand groups)
        if (Array.isArray(opt?.options)) {
            validateCommandOptionsRecursive(
                opt.options,
                {
                    commandIndex,
                    commandName,
                    sourceFile,
                    parentPath: currentPath,
                },
                issues,
            );
        }
    });
}

/**
 * Validate all slash commands before sending them to Discord API.
 * Never mutates or deletes any command entry.
 */
function validateSlashCommands(commands, metaMap = new Map()) {
    const issues = [];
    const seenCommandNames = new Map();

    if (!Array.isArray(commands)) {
        return {
            valid: false,
            totalCommands: 0,
            issues: [
                {
                    commandIndex: -1,
                    commandName: "unknown",
                    sourceFile: "unknown",
                    fieldPath: "commands",
                    actualLength: 0,
                    maxAllowed: 0,
                    valuePreview: "",
                    reason: "Daftar slash command bukan array yang valid",
                },
            ],
        };
    }

    commands.forEach((cmd, index) => {
        const cmdName = typeof cmd?.name === "string" ? cmd.name : "";
        const sourceFile = metaMap.get(cmd) || metaMap.get(cmdName) || "unknown";
        const baseIssue = {
            commandIndex: index,
            commandName: cmdName || `command_index_${index}`,
            sourceFile,
        };

        // 1. Root command name
        if (
            cmdName.length < DISCORD_LIMITS.MIN_NAME_LENGTH ||
            cmdName.length > DISCORD_LIMITS.MAX_NAME_LENGTH ||
            cmdName !== cmdName.toLowerCase() ||
            !DISCORD_COMMAND_NAME_REGEX.test(cmdName)
        ) {
            issues.push({
                ...baseIssue,
                fieldPath: `${index}.name`,
                actualLength: cmdName.length,
                maxAllowed: DISCORD_LIMITS.MAX_NAME_LENGTH,
                valuePreview: cmdName,
                reason:
                    cmdName.length > DISCORD_LIMITS.MAX_NAME_LENGTH
                        ? `Panjang nama command (${cmdName.length}) melebihi batas maksimal (${DISCORD_LIMITS.MAX_NAME_LENGTH})`
                        : `Nama command harus huruf kecil 1-${DISCORD_LIMITS.MAX_NAME_LENGTH} karakter tanpa spasi`,
            });
        } else if (seenCommandNames.has(cmdName)) {
            issues.push({
                ...baseIssue,
                fieldPath: `${index}.name`,
                actualLength: cmdName.length,
                maxAllowed: DISCORD_LIMITS.MAX_NAME_LENGTH,
                valuePreview: cmdName,
                reason: `Duplikasi nama slash command "/${cmdName}" dengan index ${seenCommandNames.get(cmdName)}`,
            });
        } else {
            seenCommandNames.set(cmdName, index);
        }

        // 2. Root command description (1 - 100 chars for ChatInput commands)
        const isChatInput = !cmd?.type || cmd.type === 1;
        if (isChatInput) {
            const desc = typeof cmd?.description === "string" ? cmd.description : "";
            if (desc.length < DISCORD_LIMITS.MIN_DESCRIPTION_LENGTH || desc.length > DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH) {
                issues.push({
                    ...baseIssue,
                    fieldPath: `${index}.description`,
                    actualLength: desc.length,
                    maxAllowed: DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH,
                    valuePreview: desc,
                    reason:
                        desc.length === 0
                            ? `Deskripsi utama command kosong (minimal ${DISCORD_LIMITS.MIN_DESCRIPTION_LENGTH} karakter)`
                            : `Deskripsi utama command melebihi batas maksimal Discord (${desc.length}/${DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH} karakter)`,
                });
            }
        }

        validateLocalizationMap(
            cmd?.name_localizations || cmd?.nameLocalizations,
            DISCORD_LIMITS.MAX_NAME_LENGTH,
            baseIssue,
            `${index}.name_localizations`,
            issues,
        );
        validateLocalizationMap(
            cmd?.description_localizations || cmd?.descriptionLocalizations,
            DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH,
            baseIssue,
            `${index}.description_localizations`,
            issues,
        );

        // 3. Options / Subcommands / SubcommandGroups
        if (Array.isArray(cmd?.options)) {
            validateCommandOptionsRecursive(
                cmd.options,
                {
                    commandIndex: index,
                    commandName: baseIssue.commandName,
                    sourceFile,
                    parentPath: `${index}`,
                },
                issues,
            );
        }
    });

    return {
        valid: issues.length === 0,
        totalCommands: commands.length,
        issues,
    };
}

/**
 * Resolve a dot-separated Discord error path (e.g. "description" or "options.0.options.1.description")
 * against a command object so logs show exact option names, description length, and Discord max limit.
 */
function resolveFieldDetailsOnCommand(cmd, commandIndex, rawSubPath, errorMessage = "") {
    const segments = String(rawSubPath || "")
        .split(".")
        .filter(Boolean);

    let current = cmd;
    const readableParts = [`${commandIndex}`];

    for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        if (seg === "options" && Array.isArray(current?.options) && /^\d+$/.test(segments[i + 1] || "")) {
            const optIdx = Number(segments[i + 1]);
            const optObj = current.options[optIdx];
            const optName = optObj?.name ? ` (${getOptionTypeLabel(optObj.type)}: ${optObj.name})` : "";
            readableParts.push(`options[${optIdx}]${optName}`);
            current = optObj;
            i += 1;
            continue;
        }

        if (seg === "choices" && Array.isArray(current?.choices) && /^\d+$/.test(segments[i + 1] || "")) {
            const choiceIdx = Number(segments[i + 1]);
            const choiceObj = current.choices[choiceIdx];
            const choiceLabel = choiceObj?.name ? ` (${choiceObj.name})` : "";
            readableParts.push(`choices[${choiceIdx}]${choiceLabel}`);
            current = choiceObj;
            i += 1;
            continue;
        }

        readableParts.push(seg);
        current = current != null ? current[seg] : undefined;
    }

    const lastField = segments[segments.length - 1] || "";
    const actualLength =
        typeof current === "string"
            ? current.length
            : Array.isArray(current)
              ? current.length
              : typeof cmd?.description === "string" && lastField === "description"
                ? cmd.description.length
                : null;

    let maxAllowed = null;
    const maxMatch = String(errorMessage || "").match(/Must be (\d+) or fewer in length/i);
    if (maxMatch) {
        maxAllowed = Number(maxMatch[1]);
    } else if (lastField.includes("description")) {
        maxAllowed = DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH;
    } else if (lastField === "name") {
        maxAllowed = rawSubPath.includes("choices") ? DISCORD_LIMITS.MAX_CHOICE_NAME_LENGTH : DISCORD_LIMITS.MAX_NAME_LENGTH;
    } else if (lastField === "options") {
        maxAllowed = DISCORD_LIMITS.MAX_OPTIONS_PER_LEVEL;
    } else if (lastField === "choices") {
        maxAllowed = DISCORD_LIMITS.MAX_CHOICES_PER_OPTION;
    }

    return {
        fieldPath: readableParts.join("."),
        actualLength,
        maxAllowed,
        valuePreview: typeof current === "string" ? current : null,
    };
}

function walkRawDiscordErrorsTree(node, pathSegments, collector) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node._errors)) {
        for (const item of node._errors) {
            collector.push({
                pathSegments: [...pathSegments],
                code: item?.code || "VALIDATION_ERROR",
                message: item?.message || "Invalid value",
            });
        }
    }

    for (const [key, child] of Object.entries(node)) {
        if (key === "_errors") continue;
        walkRawDiscordErrorsTree(child, [...pathSegments, key], collector);
    }
}

/**
 * Parse DiscordAPIError[50035] (Invalid Form Body) into human-readable command diagnostics
 * containing: Nama command, Index command, Bagian yang bermasalah, Panjang deskripsi, Batas maksimal.
 */
function parseDiscordRegistrationError(err, commands = [], metaMap = new Map()) {
    const diagnostics = [];
    const seenKeys = new Set();

    const pushDiag = (cmdIdx, subPath, code, message) => {
        const key = `${cmdIdx}:${subPath}:${code}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);

        const cmd = Number.isInteger(cmdIdx) && cmdIdx >= 0 ? commands[cmdIdx] : null;
        const commandName = cmd?.name || `unknown_command_at_index_${cmdIdx}`;
        const sourceFile = (cmd && metaMap.get(cmd)) || metaMap.get(commandName) || "unknown";
        const resolved = resolveFieldDetailsOnCommand(cmd, cmdIdx, subPath, message);

        diagnostics.push({
            commandIndex: cmdIdx,
            commandName,
            sourceFile,
            fieldPath: resolved.fieldPath,
            actualLength: resolved.actualLength,
            maxAllowed: resolved.maxAllowed,
            errorCode: code,
            discordMessage: message,
            valuePreview: resolved.valuePreview,
        });
    };

    // 1. Parse structured `err.rawError.errors` tree from @discordjs/rest if present
    if (err?.rawError?.errors && typeof err.rawError.errors === "object") {
        const rawEntries = [];
        walkRawDiscordErrorsTree(err.rawError.errors, [], rawEntries);
        for (const entry of rawEntries) {
            const [firstSeg, ...rest] = entry.pathSegments;
            if (/^\d+$/.test(firstSeg || "")) {
                pushDiag(Number(firstSeg), rest.join("."), entry.code, entry.message);
            }
        }
    }

    // 2. Also parse formatted message lines such as:
    //    `32.description[BASE_TYPE_MAX_LENGTH]: Must be 100 or fewer in length.`
    const msg = String(err?.message || "");
    const lineRegex = /(?:^|\s)(\d+)\.([^\s[\]]+)\[([^\]]+)\]:\s*([^\n]+)/g;
    let match;
    while ((match = lineRegex.exec(msg)) !== null) {
        const cmdIdx = Number(match[1]);
        const subPath = match[2];
        const code = match[3];
        const detailMsg = match[4].trim();
        pushDiag(cmdIdx, subPath, code, detailMsg);
    }

    return diagnostics;
}

function formatIssueDetailLines(item) {
    const lengthText = item.actualLength !== null && item.actualLength !== undefined ? `${item.actualLength} karakter` : "tidak diketahui";
    const maxText = item.maxAllowed !== null && item.maxAllowed !== undefined ? `${item.maxAllowed} karakter` : "sesuai batas Discord API";
    const fileNote = item.sourceFile && item.sourceFile !== "unknown" ? ` (${item.sourceFile})` : "";

    return [
        `  - Nama command               : /${item.commandName}${fileNote}`,
        `  - Index command              : ${item.commandIndex}`,
        `  - Bagian yang bermasalah     : ${item.fieldPath}`,
        `  - Panjang deskripsi          : ${lengthText}`,
        `  - Batas maksimal diizinkan   : ${maxText}`,
        ...(item.reason ? [`  - Keterangan                 : ${item.reason}`] : []),
        ...(item.discordMessage ? [`  - Pesan Discord API          : [${item.errorCode}] ${item.discordMessage}`] : []),
        ...(item.valuePreview ? [`  - Isi saat ini               : "${item.valuePreview}"`] : []),
    ].join("\n");
}

function loadSlashCommandsFromDisk(interactionRoot = path.join(__dirname, "../commands/interaction")) {
    const commands = [];
    const metaMap = new Map();

    const dirs = readdirSync(interactionRoot).sort();
    for (const dir of dirs) {
        const dirPath = path.join(interactionRoot, dir);
        const files = readdirSync(dirPath)
            .filter((file) => file.endsWith(".js"))
            .sort();

        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            const pull = require(fullPath);
            if (pull?.name) {
                commands.push(pull);
                metaMap.set(pull, `${dir}/${file}`);
                metaMap.set(pull.name, `${dir}/${file}`);
            }
        }
    }

    return { commands, metaMap };
}

if (require.main === module) {
    const { commands, metaMap } = loadSlashCommandsFromDisk();
    const report = validateSlashCommands(commands, metaMap);

    if (!report.valid) {
        console.error(`❌ Validasi Slash Command GAGAL (${report.issues.length} masalah ditemukan dari ${report.totalCommands} command):`);
        report.issues.forEach((issue, idx) => {
            console.error(`\n[Masalah #${idx + 1}]\n${formatIssueDetailLines(issue)}`);
        });
        process.exit(1);
    }

    console.log(
        `✅ Validasi Slash Command BERHASIL: ${report.totalCommands} command valid (seluruh command, subcommand, dan option <= ${DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH} karakter).`,
    );
}

module.exports = {
    DISCORD_LIMITS,
    validateSlashCommands,
    parseDiscordRegistrationError,
    formatIssueDetailLines,
    loadSlashCommandsFromDisk,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
