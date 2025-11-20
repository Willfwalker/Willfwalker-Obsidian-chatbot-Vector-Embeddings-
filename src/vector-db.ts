import { App, TFile } from 'obsidian';

export interface VectorEntry {
	id: string;           // Note path
	embedding: number[];  // Vector embedding
	content: string;      // Note content (for context)
	title: string;        // Note title
	modified: number;     // Last modified timestamp
	tags?: string[];      // Note tags
}

export interface SearchResult {
	note: VectorEntry;
	similarity: number;
}

export interface DatabaseStats {
	totalNotes: number;
	lastUpdated: string | null;
}

export class VectorDatabase {
	private app: App;
	private plugin: any;
	private dbPath: string;
	private db: Map<string, VectorEntry>;
	private loaded: boolean = false;

	constructor(app: App, plugin: any) {
		this.app = app;
		this.plugin = plugin;
		this.dbPath = '.obsidian/plugins/gemini-vector-chat/vectors.json';
		this.db = new Map();
		this.loadDatabase();
	}

	private async loadDatabase() {
		try {
			const adapter = this.app.vault.adapter;
			if (await adapter.exists(this.dbPath)) {
				const data = await adapter.read(this.dbPath);
				const parsed = JSON.parse(data);

				// Convert array back to Map
				if (parsed.vectors && Array.isArray(parsed.vectors)) {
					parsed.vectors.forEach((entry: VectorEntry) => {
						this.db.set(entry.id, entry);
					});
				}
			}
			this.loaded = true;
		} catch (error) {
			console.error('Error loading vector database:', error);
			this.db = new Map();
			this.loaded = true;
		}
	}

	private async saveDatabase() {
		try {
			const adapter = this.app.vault.adapter;
			const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf('/'));

			// Ensure directory exists
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}

			// Convert Map to array for storage
			const data = {
				version: '1.0.0',
				lastUpdated: new Date().toISOString(),
				vectors: Array.from(this.db.values())
			};

			await adapter.write(this.dbPath, JSON.stringify(data, null, 2));
		} catch (error) {
			console.error('Error saving vector database:', error);
			throw error;
		}
	}

	async addVector(entry: VectorEntry) {
		// Ensure database is loaded
		if (!this.loaded) {
			await this.loadDatabase();
		}

		this.db.set(entry.id, entry);
		await this.saveDatabase();
	}

	async addVectors(entries: VectorEntry[]) {
		// Ensure database is loaded
		if (!this.loaded) {
			await this.loadDatabase();
		}

		entries.forEach(entry => {
			this.db.set(entry.id, entry);
		});

		await this.saveDatabase();
	}

	async removeVector(id: string) {
		if (!this.loaded) {
			await this.loadDatabase();
		}

		this.db.delete(id);
		await this.saveDatabase();
	}

	async getVector(id: string): Promise<VectorEntry | undefined> {
		if (!this.loaded) {
			await this.loadDatabase();
		}

		return this.db.get(id);
	}

	async search(queryEmbedding: number[], topK: number = 5): Promise<SearchResult[]> {
		if (!this.loaded) {
			await this.loadDatabase();
		}

		if (!queryEmbedding || queryEmbedding.length === 0) {
			return [];
		}

		const results: SearchResult[] = [];

		// Calculate similarity for each vector in the database
		for (const entry of this.db.values()) {
			if (entry.embedding && entry.embedding.length > 0) {
				const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
				results.push({ note: entry, similarity });
			}
		}

		// Sort by similarity (descending) and return top K
		results.sort((a, b) => b.similarity - a.similarity);
		return results.slice(0, topK);
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			console.warn('Vector length mismatch:', a.length, 'vs', b.length);
			return 0;
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		if (normA === 0 || normB === 0) {
			return 0;
		}

		return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
	}

	async clear() {
		this.db.clear();
		await this.saveDatabase();
	}

	async getStats(): Promise<DatabaseStats> {
		if (!this.loaded) {
			await this.loadDatabase();
		}

		let lastUpdated: string | null = null;

		if (this.db.size > 0) {
			// Find the most recent modification time
			let latestTime = 0;
			for (const entry of this.db.values()) {
				if (entry.modified > latestTime) {
					latestTime = entry.modified;
				}
			}

			if (latestTime > 0) {
				lastUpdated = new Date(latestTime).toLocaleString();
			}
		}

		return {
			totalNotes: this.db.size,
			lastUpdated
		};
	}

	async getAllNoteIds(): Promise<string[]> {
		if (!this.loaded) {
			await this.loadDatabase();
		}

		return Array.from(this.db.keys());
	}

	async needsReindexing(): Promise<boolean> {
		if (!this.loaded) {
			await this.loadDatabase();
		}

		// Check if database is empty
		if (this.db.size === 0) {
			return true;
		}

		// Check if any notes are missing or have been modified
		const files = this.app.vault.getMarkdownFiles();

		// Quick check: if file count doesn't match, we need reindexing
		if (files.length !== this.db.size) {
			return true;
		}

		// Check a sample of files for modifications
		const samplSize = Math.min(10, files.length);
		for (let i = 0; i < samplSize; i++) {
			const file = files[Math.floor(Math.random() * files.length)];
			const entry = this.db.get(file.path);

			if (!entry || file.stat.mtime > entry.modified) {
				return true;
			}
		}

		return false;
	}

	async getModifiedNotes(): Promise<TFile[]> {
		if (!this.loaded) {
			await this.loadDatabase();
		}

		const modifiedFiles: TFile[] = [];
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const entry = this.db.get(file.path);

			// Note is new or modified
			if (!entry || file.stat.mtime > entry.modified) {
				modifiedFiles.push(file);
			}
		}

		return modifiedFiles;
	}

	async removeDeletedNotes() {
		if (!this.loaded) {
			await this.loadDatabase();
		}

		const files = this.app.vault.getMarkdownFiles();
		const currentPaths = new Set(files.map(f => f.path));
		const toDelete: string[] = [];

		// Find notes that no longer exist
		for (const id of this.db.keys()) {
			if (!currentPaths.has(id)) {
				toDelete.push(id);
			}
		}

		// Remove them from database
		for (const id of toDelete) {
			this.db.delete(id);
		}

		if (toDelete.length > 0) {
			await this.saveDatabase();
		}

		return toDelete.length;
	}
}