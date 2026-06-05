//document.querySelector('[action="/errors/validateCaptcha"] img').src
// AIzaSyCYvmUxktBFytTwsifqwls81liI4JTrP4M
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

const GEMINI_API_KEY = global.data.parentAcc.geminiKey;
const MODEL_NAME = 'gemini-1.5-flash-latest';
const KNOWN_MIME_TYPE = 'image/jpeg';

const SYSTEM_INSTRUCTION = {
	parts: [{ text: `Given an image of a CAPTCHA, extract and return ONLY the 6 alphanumeric characters present. Do not include any other text, explanation, or formatting. Just the 6 characters.` }],
};

const GENERATION_CONFIG = {
	maxOutputTokens: 15,
	responseMimeType: 'text/plain',
};

async function solveCaptchaFromUrl(imageUrl) {
	if (!GEMINI_API_KEY) {
		console.error("Lỗi: chưa cấu hình GEMINI_API_KEY.");
		return { success: false, captchaCode: null, error: "Chưa cấu hình API Key" };
	}
	if (!imageUrl) {
		console.error("Lỗi: thiếu URL ảnh CAPTCHA.");
		return { success: false, captchaCode: null, error: "Thiếu URL ảnh" };
	}

	const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
	const model = genAI.getGenerativeModel({
		model: MODEL_NAME,
		systemInstruction: SYSTEM_INSTRUCTION,
		generationConfig: GENERATION_CONFIG,
	});

	let imagePart;
	try {
		console.log(`Đang tải ảnh CAPTCHA từ: ${imageUrl}`);
		const response = await axios.get(imageUrl, {
			responseType: 'arraybuffer',
		});

		if (!response.data || response.data.byteLength < 100) { // Basic check
			throw new Error(`Dữ liệu tải về quá nhỏ hoặc rỗng.`);
		}

		const imageData = Buffer.from(response.data);
		const base64Data = imageData.toString('base64');
		console.log(`Đã tải và mã hóa ảnh (${(imageData.length / 1024).toFixed(2)} KB).`);

		imagePart = {
			inlineData: {
				mimeType: KNOWN_MIME_TYPE,
				data: base64Data,
			},
		};
	} catch (error) {
		const errorMessage = axios.isAxiosError(error)
			? `Status ${error.response?.status}: ${error.message}`
			: error.message;
		console.error(`Lỗi khi tải/xử lý ảnh từ URL (${imageUrl}): ${errorMessage}`);
		return { success: false, captchaCode: null, error: `Tải/xử lý ảnh thất bại: ${errorMessage}` };
	}

	const promptParts = [
		imagePart
	];

	try {
		console.log("Đang gửi yêu cầu giải CAPTCHA tới Gemini API...");
		const result = await model.generateContentStream(promptParts);

		let fullResponse = '';
		for await (const chunk of result.stream) {
			const chunkText = chunk.text();
			if (chunkText) {
				fullResponse += chunkText;
			}
		}

		const cleanedResponse = fullResponse.trim().replace(/\s+/g, '');

		if (cleanedResponse.length === 6) {
			console.log(`Đã nhận đủ 6 ký tự CAPTCHA: ${cleanedResponse}`);
			return { success: true, captchaCode: cleanedResponse, error: null };
		} else {
			console.error(`Lỗi: phản hồi không hợp lệ. Cần 6 ký tự, nhận ${cleanedResponse.length}. Phản hồi gốc: "${fullResponse}"`);
			return { success: false, captchaCode: null, error: `Độ dài phản hồi không hợp lệ (${cleanedResponse.length}). Gốc: "${fullResponse}"` };
		}

	} catch (apiError) {
		console.error("\nLỗi khi gọi Gemini API:", apiError.message);
		return { success: false, captchaCode: null, error: `Lỗi API: ${apiError.message}` };
	}
}

module.exports = solveCaptchaFromUrl;
