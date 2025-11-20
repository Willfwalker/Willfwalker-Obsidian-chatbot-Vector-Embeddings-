import { GoogleGenerativeAI } from '@google/generative-ai';

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	context?: string[];
}

export class GeminiService {
	private genAI: GoogleGenerativeAI;
	private settings: any;
	private embeddingModel: any;
	private chatModel: any;

	constructor(apiKey: string, settings: any) {
		this.settings = settings;
		this.genAI = new GoogleGenerativeAI(apiKey);
		this.initializeModels();
	}

	private initializeModels() {
		// Initialize embedding model
		this.embeddingModel = this.genAI.getGenerativeModel({
			model: this.settings.embeddingModel || 'text-embedding-004'
		});

		// Initialize chat model
		this.chatModel = this.genAI.getGenerativeModel({
			model: this.settings.model || 'gemini-2.0-flash',
			generationConfig: {
				temperature: this.settings.temperature || 0.7,
				topK: 40,
				topP: 0.95,
				maxOutputTokens: 8192,
			}
		});
	}

	updateSettings(settings: any) {
		this.settings = settings;
		if (settings.geminiApiKey) {
			this.genAI = new GoogleGenerativeAI(settings.geminiApiKey);
			this.initializeModels();
		}
	}

	async generateEmbedding(text: string): Promise<number[]> {
		try {
			// Clean and truncate text if needed
			const cleanText = text.trim().substring(0, 10000); // Limit to 10k chars

			if (!cleanText) {
				return [];
			}

			// Generate embedding using the embedding model
			const result = await this.embeddingModel.embedContent(cleanText);
			return result.embedding.values;
		} catch (error) {
			console.error('Error generating embedding:', error);
			throw new Error(`Failed to generate embedding: ${error.message}`);
		}
	}

	async generateEmbeddings(texts: string[]): Promise<number[][]> {
		const embeddings: number[][] = [];

		// Process in batches to avoid rate limiting
		const batchSize = 5;
		for (let i = 0; i < texts.length; i += batchSize) {
			const batch = texts.slice(i, i + batchSize);
			const batchPromises = batch.map(text => this.generateEmbedding(text));

			try {
				const batchResults = await Promise.all(batchPromises);
				embeddings.push(...batchResults);
			} catch (error) {
				console.error(`Error in batch ${i / batchSize}:`, error);
				// Add empty embeddings for failed items
				embeddings.push(...batch.map(() => []));
			}

			// Small delay between batches to avoid rate limiting
			if (i + batchSize < texts.length) {
				await new Promise(resolve => setTimeout(resolve, 200));
			}
		}

		return embeddings;
	}

	async chat(messages: ChatMessage[], context: string[]): Promise<string> {
		try {
			// Build the prompt with context
			let systemPrompt = `You are a helpful assistant that answers questions about the user's Obsidian notes.
			Use the following relevant note excerpts to answer the user's question.
			Always cite which notes you're referencing when providing information. If you are not using notes then say that you are not.

			Relevant notes context:
			${context.map((note, i) => `[Note ${i + 1}]: ${note}`).join('\n\n')}

			Now answer the user's question based on the above context.`;

			// Convert messages to Gemini format
			const formattedMessages = messages.map(msg => ({
				role: msg.role === 'user' ? 'user' : 'model',
				parts: [{ text: msg.content }]
			}));

			// Add system prompt as first message if we have context
			if (context.length > 0) {
				formattedMessages.unshift({
					role: 'user',
					parts: [{ text: systemPrompt }]
				}, {
					role: 'model',
					parts: [{ text: 'I understand. I\'ll answer questions based on the provided note excerpts and cite my sources.' }]
				});
			}

			// Start chat session
			const chat = this.chatModel.startChat({
				history: formattedMessages.slice(0, -1), // All messages except the last one
				generationConfig: {
					temperature: this.settings.temperature || 0.7,
					topK: 40,
					topP: 0.95,
					maxOutputTokens: 8192,
				}
			});

			// Send the last message and get response
			const lastMessage = messages[messages.length - 1];
			const result = await chat.sendMessage(lastMessage.content);
			const response = await result.response;
			return response.text();

		} catch (error) {
			console.error('Chat error:', error);
			throw new Error(`Chat failed: ${error.message}`);
		}
	}

	async testConnection(): Promise<boolean> {
		try {
			// Try to generate a simple embedding as a test
			const test = await this.generateEmbedding("test");
			return test && test.length > 0;
		} catch (error) {
			console.error('Connection test failed:', error);
			return false;
		}
	}
}