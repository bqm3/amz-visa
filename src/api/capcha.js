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
		console.error("Error: GEMINI_API_KEY environment variable is not set.");
		return { success: false, captchaCode: null, error: "API Key not configured" };
	}
	if (!imageUrl) {
		console.error("Error: Image URL is required.");
		return { success: false, captchaCode: null, error: "Image URL missing" };
	}

	const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
	const model = genAI.getGenerativeModel({
		model: MODEL_NAME,
		systemInstruction: SYSTEM_INSTRUCTION,
		generationConfig: GENERATION_CONFIG,
	});

	let imagePart;
	try {
		console.log(`Fetching image from: ${imageUrl}`);
		const response = await axios.get(imageUrl, {
			responseType: 'arraybuffer',
		});

		if (!response.data || response.data.byteLength < 100) { // Basic check
			throw new Error(`Downloaded data seems too small or empty.`);
		}

		const imageData = Buffer.from(response.data);
		const base64Data = imageData.toString('base64');
		console.log(`Successfully fetched and encoded image (${(imageData.length / 1024).toFixed(2)} KB).`);

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
		console.error(`Error fetching/processing image from URL (${imageUrl}): ${errorMessage}`);
		return { success: false, captchaCode: null, error: `Image fetch/process failed: ${errorMessage}` };
	}

	const promptParts = [
		imagePart
	];

	try {
		console.log("Sending request to Gemini API...");
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
			console.log(`Successfully extracted 6 characters: ${cleanedResponse}`);
			return { success: true, captchaCode: cleanedResponse, error: null };
		} else {
			console.error(`Error: Response validation failed. Expected 6 characters, got ${cleanedResponse.length}. Raw Response: "${fullResponse}"`);
			return { success: false, captchaCode: null, error: `Invalid response length (${cleanedResponse.length}). Raw: "${fullResponse}"` };
		}

	} catch (apiError) {
		console.error("\nError calling Gemini API:", apiError.message);
		return { success: false, captchaCode: null, error: `API Error: ${apiError.message}` };
	}
}

module.exports = solveCaptchaFromUrl;