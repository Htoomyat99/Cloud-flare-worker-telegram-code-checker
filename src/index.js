// Remove numbering like 3. , 3), 3-
function normalizeLine(line) {
	return line.replace(/^\s*\d+[\.\)\-]\s*/, '').trim();
}

// Validate exactly 18 alphanumeric characters
function isValidCode(code) {
	return /^[A-Za-z0-9]{18}$/.test(code);
}

// Emojis for duplicate groups (same message)
const DUPLICATE_MARKS = ['🔴', '🟡', '🔵', '🟣', '🟠', '🟤', '⚫'];

// Daily KV key
function getTodayKey(userId) {
	const today = new Date().toISOString().slice(0, 10);
	return `${userId}:${today}`;
}

// Send Telegram message
async function sendMessage(env, chatId, text) {
	await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text,
			parse_mode: 'Markdown',
		}),
	});
}

function processText(text) {
	const lines = text.split(/\s+/);

	const validEntries = [];
	const invalidEntries = [];

	lines.forEach((line, i) => {
		const code = normalizeLine(line);
		if (!code) return;

		const entry = { index: i + 1, code };

		if (isValidCode(code)) validEntries.push(entry);
		else invalidEntries.push(entry);
	});

	// Count duplicates inside message
	const countMap = {};
	for (const { code } of validEntries) {
		countMap[code] = (countMap[code] || 0) + 1;
	}

	// Assign emoji groups
	const duplicateColorMap = {};
	let colorIndex = 0;

	for (const code in countMap) {
		if (countMap[code] > 1) {
			duplicateColorMap[code] = DUPLICATE_MARKS[colorIndex % DUPLICATE_MARKS.length];
			colorIndex++;
		}
	}

	let response = '';

	// ❌ Invalid codes
	response += '❌ Invalid codes:\n';
	if (invalidEntries.length) {
		for (const { index, code } of invalidEntries) {
			response += `${index}. ${code}\n`;
		}
	} else {
		response += '✅ No invalid code\n';
	}

	response += '\n🎨 Duplicate check (this message):\n';

	// Same-message duplicates
	if (Object.keys(duplicateColorMap).length) {
		const seen = new Set();

		for (const { code } of validEntries) {
			if (duplicateColorMap[code] && !seen.has(code)) {
				seen.add(code);
				const emoji = duplicateColorMap[code];

				for (const e of validEntries) {
					if (e.code === code) {
						response += `${e.index}. ${e.code} ${emoji}\n`;
					}
				}
				response += '\n';
			}
		}
	} else {
		response += '✅ No duplicate code\n\n';
	}

	// Unique codes from THIS message
	const uniqueCodes = Object.keys(countMap);

	return { response, uniqueCodes };
}

export default {
	async fetch(req, env) {
		if (req.method !== 'POST') return new Response('OK');

		const update = await req.json();
		const message = update.message;
		if (!message?.text) return new Response('OK');

		const chatId = message.chat.id;
		const userId = message.from.id;
		const text = message.text;

		if (text === '/start') {
			await sendMessage(
				env,
				chatId,
				'Send codes.\n\nFeatures:\n• Invalid detection\n• Duplicate detection\n• Daily memory\n• /reset to clear today data',
			);
			return new Response('OK');
		}

		if (text === '/reset') {
			const dailyKey = getTodayKey(userId);
			await env.KV.delete(dailyKey);

			await sendMessage(env, chatId, '✅ Today data reset.');
			return new Response('OK');
		}

		// Load Stored Data

		const dailyKey = getTodayKey(userId);
		const stored = await env.KV.get(dailyKey);
		const previousCodes = stored ? JSON.parse(stored) : [];

		// Process Message (original logic)

		const { response, uniqueCodes } = processText(text);

		// Cross-day Duplicate Logic (NEW)

		const crossDuplicates = uniqueCodes.filter((code) => previousCodes.includes(code));

		const newCodes = uniqueCodes.filter((code) => !previousCodes.includes(code));

		let finalResponse = response;

		// 🚨 Duplicate for today
		finalResponse += '\n🚨 Duplicate codes for today:\n';

		if (crossDuplicates.length) {
			crossDuplicates.forEach((code) => {
				finalResponse += `${code}\n`;
			});
		} else {
			finalResponse += '✅ No duplicates for today\n';
		}

		// ✅ Final valid = only new codes
		finalResponse += `\n✅ Total unique valid codes (new today): ${newCodes.length}\n\n`;
		finalResponse += '```text\n' + newCodes.join('\n') + '\n```';

		// Save Back to KV
		const merged = [...new Set([...previousCodes, ...newCodes])];

		await env.KV.put(dailyKey, JSON.stringify(merged), {
			expirationTtl: 86400, // 24h
		});

		// Reply

		await sendMessage(env, chatId, finalResponse);
		return new Response('OK');
	},
};
