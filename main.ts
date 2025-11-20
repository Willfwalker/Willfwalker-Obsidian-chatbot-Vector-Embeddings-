import { App, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf } from 'obsidian';
import { GeminiService } from './src/gemini-service';
import { VectorDatabase } from './src/vector-db';
import { ChatView, VIEW_TYPE_GEMINI_CHAT } from './src/chat-view';
import { NoteIndexer } from './src/indexer';

interface GeminiVectorChatSettings {
	geminiApiKey: string;
	model: string;
	embeddingModel: string;
	temperature: number;
	topK: number;
	autoIndex: boolean;
	showDebugInfo: boolean;
}

const DEFAULT_SETTINGS: GeminiVectorChatSettings = {
	geminiApiKey: '',
	model: 'gemini-2.0-flash',
	embeddingModel: 'text-embedding-004',
	temperature: 0.7,
	topK: 5,
	autoIndex: true,
	showDebugInfo: false
}

export default class GeminiVectorChatPlugin extends Plugin {
	settings: GeminiVectorChatSettings;
	geminiService: GeminiService;
	vectorDb: VectorDatabase;
	indexer: NoteIndexer;
	chatView: ChatView | null = null;

	async onload() {
		await this.loadSettings();

		// Check if API key is configured
		if (!this.settings.geminiApiKey) {
			new Notice('⚠️ Gemini API key not configured. Please add your API key in settings.');
		}

		// Initialize services
		this.geminiService = new GeminiService(this.settings.geminiApiKey || 'placeholder', this.settings);
		this.vectorDb = new VectorDatabase(this.app, this);
		this.indexer = new NoteIndexer(this.app, this.geminiService, this.vectorDb, this);

		// Register the chat view
		this.registerView(
			VIEW_TYPE_GEMINI_CHAT,
			(leaf) => {
				this.chatView = new ChatView(leaf, this);
				return this.chatView;
			}
		);

		// Add ribbon icon
		const ribbonIconEl = this.addRibbonIcon('message-square', 'Gemini Chat', (evt: MouseEvent) => {
			this.activateChatView();
		});

		// Add commands
		this.addCommand({
			id: 'open-gemini-chat',
			name: 'Open Gemini Chat',
			callback: () => {
				this.activateChatView();
			}
		});

		this.addCommand({
			id: 'index-all-notes',
			name: 'Index all notes for semantic search',
			callback: async () => {
				new Notice('Starting indexing process...');
				try {
					const count = await this.indexer.indexAllNotes();
					new Notice(`Successfully indexed ${count} notes!`);
				} catch (error) {
					console.error('Indexing error:', error);
					new Notice(`Indexing failed: ${error.message}`);
				}
			}
		});

		this.addCommand({
			id: 'clear-vector-database',
			name: 'Clear vector database',
			callback: async () => {
				try {
					await this.vectorDb.clear();
					new Notice('Vector database cleared successfully');
				} catch (error) {
					new Notice(`Failed to clear database: ${error.message}`);
				}
			}
		});

		// Add settings tab
		this.addSettingTab(new GeminiVectorChatSettingTab(this.app, this));

		// Auto-index on startup if enabled
		if (this.settings.autoIndex) {
			// Wait a bit for the vault to be fully loaded
			this.app.workspace.onLayoutReady(async () => {
				const needsIndexing = await this.vectorDb.needsReindexing();
				if (needsIndexing) {
					new Notice('Auto-indexing notes for Gemini Chat...');
					try {
						const count = await this.indexer.indexAllNotes();
						new Notice(`Indexed ${count} notes successfully`);
					} catch (error) {
						console.error('Auto-indexing error:', error);
					}
				}
			});
		}
	}

	async activateChatView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_GEMINI_CHAT);

		if (leaves.length > 0) {
			// A chat view already exists, activate it
			leaf = leaves[0];
		} else {
			// Create a new leaf in the right sidebar
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
			} else {
				leaf = workspace.getLeaf(true);
			}

			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_GEMINI_CHAT,
					active: true,
				});
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	onunload() {
		// Cleanup
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_GEMINI_CHAT);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update services with new settings
		this.geminiService.updateSettings(this.settings);
	}
}

class GeminiVectorChatSettingTab extends PluginSettingTab {
	plugin: GeminiVectorChatPlugin;

	constructor(app: App, plugin: GeminiVectorChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Gemini Vector Chat Settings'});

		// API Key setting
		new Setting(containerEl)
			.setName('Gemini API Key')
			.setDesc('Enter your Google Gemini API key')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.geminiApiKey)
				.onChange(async (value) => {
					this.plugin.settings.geminiApiKey = value;
					await this.plugin.saveSettings();
				})
				.inputEl.type = 'password'
			);

		// Model selection
		new Setting(containerEl)
			.setName('Chat Model')
			.setDesc('Select the Gemini model to use for chat')
			.addDropdown(dropdown => dropdown
				.addOption('gemini-2.0-flash', 'Gemini 2.0 Flash (Recommended)')
				.addOption('gemini-2.0-flash-002', 'Gemini 2.0 Flash v002')
				.addOption('gemini-1.5-flash-002', 'Gemini 1.5 Flash v002')
				.addOption('gemini-1.5-pro-002', 'Gemini 1.5 Pro v002 (Advanced)')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				})
			);

		// Temperature setting
		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness in responses (0 = deterministic, 1 = creative)')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.1)
				.setValue(this.plugin.settings.temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.temperature = value;
					await this.plugin.saveSettings();
				})
			);

		// Top K results
		new Setting(containerEl)
			.setName('Search Results')
			.setDesc('Number of relevant notes to include in context')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.topK)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.topK = value;
					await this.plugin.saveSettings();
				})
			);

		// Auto-index setting
		new Setting(containerEl)
			.setName('Auto-index on startup')
			.setDesc('Automatically index new or modified notes when Obsidian starts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoIndex)
				.onChange(async (value) => {
					this.plugin.settings.autoIndex = value;
					await this.plugin.saveSettings();
				})
			);

		// Debug info setting
		new Setting(containerEl)
			.setName('Show debug information')
			.setDesc('Display technical information in chat (useful for troubleshooting)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showDebugInfo)
				.onChange(async (value) => {
					this.plugin.settings.showDebugInfo = value;
					await this.plugin.saveSettings();
				})
			);

		// Index stats
		containerEl.createEl('h3', {text: 'Database Statistics'});

		const statsDiv = containerEl.createDiv('gemini-stats');
		this.updateStats(statsDiv);

		// Action buttons
		containerEl.createEl('h3', {text: 'Actions'});

		new Setting(containerEl)
			.setName('Index All Notes')
			.setDesc('Build vector embeddings for all notes in your vault')
			.addButton(button => button
				.setButtonText('Start Indexing')
				.setCta()
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Indexing...');
					try {
						const count = await this.plugin.indexer.indexAllNotes();
						new Notice(`Successfully indexed ${count} notes!`);
						this.updateStats(statsDiv);
					} catch (error) {
						new Notice(`Indexing failed: ${error.message}`);
					} finally {
						button.setButtonText('Start Indexing');
						button.setDisabled(false);
					}
				})
			);

		new Setting(containerEl)
			.setName('Clear Database')
			.setDesc('Remove all indexed vectors (you\'ll need to re-index)')
			.addButton(button => button
				.setButtonText('Clear Database')
				.setWarning()
				.onClick(async () => {
					try {
						await this.plugin.vectorDb.clear();
						new Notice('Vector database cleared');
						this.updateStats(statsDiv);
					} catch (error) {
						new Notice(`Failed to clear: ${error.message}`);
					}
				})
			);
	}

	async updateStats(container: HTMLElement) {
		container.empty();
		try {
			const stats = await this.plugin.vectorDb.getStats();
			container.createEl('p', {
				text: `Indexed notes: ${stats.totalNotes} | Last updated: ${stats.lastUpdated || 'Never'}`
			});
		} catch (error) {
			container.createEl('p', {
				text: 'Unable to load statistics'
			});
		}
	}
}