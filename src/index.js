// Remove numbering like 3. , 3), 3-
function normalizeLine(line) {
	return line.replace(/^\s*\d+[\.\)\-]\s*/, '').trim();
}

// Validate exactly 18 alphanumeric characters
function isValidCode(code) {
	return /^[A-Za-z0-9]{18}$/.test(code);
}

// Emojis for duplicate groups
const DUPLICATE_MARKS = ['🔴', '🟡', '🔵', '🟣', '🟠', '🟤', '⚫'];

// Process incoming text and return formatted response
function processText(text) {
	const lines = text.split(/\s+/);

	const validEntries = [];
	const invalidEntries = [];

	// Normalize, validate, and track original line index
	lines.forEach((line, i) => {
		const code = normalizeLine(line);
		if (!code) return;

		const entry = { index: i + 1, code };

		if (isValidCode(code)) validEntries.push(entry);
		else invalidEntries.push(entry);
	});

	// Count duplicates
	const countMap = {};
	for (const { code } of validEntries) {
		countMap[code] = (countMap[code] || 0) + 1;
	}

	// Assign emojis to duplicate codes
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

	response += '\n🎨 Duplicate check:\n';

	// 🎨 Duplicate codes
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

	// ✅ Unique valid codes
	const uniqueCodes = Object.keys(countMap);
	response += `✅ Total unique valid codes: ${uniqueCodes.length}\n\n`;
	response += '```text\n' + uniqueCodes.join('\n') + '\n```';

	return response;
}

const TELEGRAM_LIMIT = 4050;

// ===== Cloudflare Worker Webhook Handler =====
export default {
	async fetch(req, env) {
		if (req.method !== 'POST') return new Response('OK');

		const update = await req.json();
		const message = update.message;

		if (!message?.text) return new Response('OK');

		const chatId = message.chat.id;
		const inputText = message.text.trim();

		let replyText;
		if (message.text === '/start') {
			replyText =
				'Send me a list of codes.\n\n' +
				'I will:\n' +
				'• Show invalid codes with original numbers\n' +
				'• Show duplicate codes with original numbers\n' +
				'• Give final unique valid codes';
		} else if (inputText.length > TELEGRAM_LIMIT) {
			replyText = '⚠️ Your input is too long.\n\n' + 'Telegram allows a maximum of 4096 characters.\n';
		} else {
			replyText = processText(inputText);
		}

		await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: replyText,
				parse_mode: 'Markdown',
			}),
		});

		return new Response('OK');
	},
};
