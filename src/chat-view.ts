import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer } from 'obsidian';
import { ChatMessage } from './gemini-service';
import { SearchResult } from './vector-db';

export const VIEW_TYPE_GEMINI_CHAT = 'gemini-chat-view';

export class ChatView extends ItemView {
	private plugin: any;
	private messages: ChatMessage[] = [];
	private chatContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputField: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private isProcessing: boolean = false;

	constructor(leaf: WorkspaceLeaf, plugin: any) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_GEMINI_CHAT;
	}

	getDisplayText(): string {
		return 'Gemini Chat';
	}

	getIcon(): string {
		return 'message-square';
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('gemini-chat-container');

		// Create main layout
		this.createHeader(container);
		this.createChatArea(container);
		this.createInputArea(container);

		// Load chat history if exists
		this.loadChatHistory();
	}

	private createHeader(container: HTMLElement) {
		const header = container.createDiv('gemini-chat-header');

		// Title
		const title = header.createEl('h4', { text: 'Chat with your notes' });

		// Action buttons
		const actions = header.createDiv('gemini-chat-actions');

		// Clear chat button
		const clearBtn = actions.createEl('button', {
			text: 'Clear Chat',
			cls: 'mod-cta'
		});
		clearBtn.onclick = () => this.clearChat();

		// Index status
		const indexBtn = actions.createEl('button', {
			text: 'Index Notes',
			cls: 'mod-cta'
		});
		indexBtn.onclick = async () => {
			indexBtn.disabled = true;
			indexBtn.textContent = 'Indexing...';
			try {
				const count = await this.plugin.indexer.indexAllNotes();
				new Notice(`Indexed ${count} notes`);
			} catch (error) {
				new Notice('Indexing failed');
			} finally {
				indexBtn.disabled = false;
				indexBtn.textContent = 'Index Notes';
			}
		};
	}

	private createChatArea(container: HTMLElement) {
		this.chatContainer = container.createDiv('gemini-chat-messages');

		// Add welcome message if no messages
		if (this.messages.length === 0) {
			this.addWelcomeMessage();
		}
	}

	private createInputArea(container: HTMLElement) {
		this.inputContainer = container.createDiv('gemini-chat-input-area');

		// Create textarea for input
		this.inputField = this.inputContainer.createEl('textarea', {
			placeholder: 'Ask a question about your notes...',
			cls: 'gemini-chat-input'
		});

		// Auto-resize textarea
		this.inputField.addEventListener('input', () => {
			this.inputField.style.height = 'auto';
			this.inputField.style.height = this.inputField.scrollHeight + 'px';
		});

		// Handle enter key
		this.inputField.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		// Send button
		const buttonContainer = this.inputContainer.createDiv('gemini-chat-button-container');
		this.sendButton = buttonContainer.createEl('button', {
			text: 'Send',
			cls: 'mod-cta gemini-send-button'
		});
		this.sendButton.onclick = () => this.sendMessage();
	}

	private addWelcomeMessage() {
		const welcomeDiv = this.chatContainer.createDiv('gemini-message gemini-assistant-message');
		welcomeDiv.createEl('div', {
			cls: 'gemini-message-content',
			text: 'Hello! I can help you explore and find information in your notes. Make sure to index your notes first using the "Index Notes" button above. Then ask me any question!'
		});
	}

	private async sendMessage() {
		const input = this.inputField.value.trim();
		if (!input || this.isProcessing) {
			return;
		}

		// Check if API key is configured
		if (!this.plugin.settings.geminiApiKey) {
			new Notice('Please configure your Gemini API key in settings');
			return;
		}

		this.isProcessing = true;
		this.inputField.disabled = true;
		this.sendButton.disabled = true;
		this.sendButton.textContent = 'Processing...';

		// Add user message to chat
		this.addMessage('user', input);
		this.inputField.value = '';
		this.inputField.style.height = 'auto';

		try {
			// Generate embedding for the query
			const queryEmbedding = await this.plugin.geminiService.generateEmbedding(input);

			// Search for relevant notes
			const searchResults = await this.plugin.vectorDb.search(
				queryEmbedding,
				this.plugin.settings.topK || 5
			);

			// Extract context from search results
			const context = this.extractContext(searchResults);

			// Show which notes were found (if debug mode)
			if (this.plugin.settings.showDebugInfo && searchResults.length > 0) {
				this.addDebugInfo(searchResults);
			}

			// Get response from Gemini
			const response = await this.plugin.geminiService.chat(
				this.messages,
				context
			);

			// Add assistant response
			this.addMessage('assistant', response);

		} catch (error) {
			console.error('Chat error:', error);
			this.addMessage('assistant', `I encountered an error: ${error.message}`);
			new Notice('Chat failed: ' + error.message);
		} finally {
			this.isProcessing = false;
			this.inputField.disabled = false;
			this.sendButton.disabled = false;
			this.sendButton.textContent = 'Send';
			this.inputField.focus();
		}

		// Save chat history
		this.saveChatHistory();
	}

	private addMessage(role: 'user' | 'assistant', content: string) {
		// Add to messages array
		this.messages.push({ role, content });

		// Create message element
		const messageDiv = this.chatContainer.createDiv(`gemini-message gemini-${role}-message`);

		// Add role label
		const roleLabel = messageDiv.createDiv('gemini-message-role');
		roleLabel.textContent = role === 'user' ? 'You' : 'Gemini';

		// Add message content
		const contentDiv = messageDiv.createDiv('gemini-message-content');

		if (role === 'assistant') {
			// Render markdown for assistant messages
			MarkdownRenderer.renderMarkdown(content, contentDiv, '', this);
		} else {
			contentDiv.textContent = content;
		}

		// Scroll to bottom
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	private addDebugInfo(results: SearchResult[]) {
		const debugDiv = this.chatContainer.createDiv('gemini-debug-info');
		debugDiv.createEl('div', {
			cls: 'gemini-debug-title',
			text: 'Found relevant notes:'
		});

		const list = debugDiv.createEl('ul');
		results.forEach(result => {
			const item = list.createEl('li');
			item.createEl('span', {
				text: `${result.note.title} (similarity: ${result.similarity.toFixed(3)})`
			});
		});
	}

	private extractContext(results: SearchResult[]): string[] {
		return results.map(result => {
			const noteInfo = `Note: "${result.note.title}" (${result.note.id})\n`;
			const content = result.note.content;
			return noteInfo + content;
		});
	}

	private clearChat() {
		this.messages = [];
		this.chatContainer.empty();
		this.addWelcomeMessage();
		this.saveChatHistory();
	}

	private async saveChatHistory() {
		try {
			const data = {
				messages: this.messages,
				timestamp: Date.now()
			};
			await this.plugin.saveData({ chatHistory: data });
		} catch (error) {
			console.error('Failed to save chat history:', error);
		}
	}

	private async loadChatHistory() {
		try {
			const data = await this.plugin.loadData();
			if (data && data.chatHistory && data.chatHistory.messages) {
				this.messages = data.chatHistory.messages;

				// Re-render messages
				this.chatContainer.empty();
				if (this.messages.length === 0) {
					this.addWelcomeMessage();
				} else {
					this.messages.forEach(msg => {
						this.renderMessage(msg);
					});
				}
			}
		} catch (error) {
			console.error('Failed to load chat history:', error);
		}
	}

	private renderMessage(message: ChatMessage) {
		const messageDiv = this.chatContainer.createDiv(`gemini-message gemini-${message.role}-message`);

		const roleLabel = messageDiv.createDiv('gemini-message-role');
		roleLabel.textContent = message.role === 'user' ? 'You' : 'Gemini';

		const contentDiv = messageDiv.createDiv('gemini-message-content');

		if (message.role === 'assistant') {
			MarkdownRenderer.renderMarkdown(message.content, contentDiv, '', this);
		} else {
			contentDiv.textContent = message.content;
		}
	}

	async onClose() {
		// Cleanup if needed
	}
}