import { App, TFile, Notice } from 'obsidian';
import { GeminiService } from './gemini-service';
import { VectorDatabase, VectorEntry } from './vector-db';

export class NoteIndexer {
	private app: App;
	private geminiService: GeminiService;
	private vectorDb: VectorDatabase;
	private plugin: any;
	private isIndexing: boolean = false;

	constructor(
		app: App,
		geminiService: GeminiService,
		vectorDb: VectorDatabase,
		plugin: any
	) {
		this.app = app;
		this.geminiService = geminiService;
		this.vectorDb = vectorDb;
		this.plugin = plugin;
	}

	async indexAllNotes(showProgress: boolean = true): Promise<number> {
		if (this.isIndexing) {
			new Notice('Indexing already in progress');
			return 0;
		}

		this.isIndexing = true;
		let indexed = 0;

		try {
			// Clean up deleted notes first
			const deletedCount = await this.vectorDb.removeDeletedNotes();
			if (deletedCount > 0 && showProgress) {
				console.log(`Removed ${deletedCount} deleted notes from index`);
			}

			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			const totalFiles = files.length;

			if (totalFiles === 0) {
				new Notice('No notes found to index');
				return 0;
			}

			if (showProgress) {
				new Notice(`Starting to index ${totalFiles} notes...`);
			}

			// Process in batches
			const batchSize = 5;
			const entries: VectorEntry[] = [];

			for (let i = 0; i < files.length; i += batchSize) {
				const batch = files.slice(i, i + batchSize);
				const batchEntries = await this.processBatch(batch);
				entries.push(...batchEntries);
				indexed += batchEntries.length;

				// Show progress
				if (showProgress && i % 10 === 0) {
					const progress = Math.round((i / totalFiles) * 100);
					new Notice(`Indexing progress: ${progress}%`, 2000);
				}
			}

			// Save all vectors to database
			if (entries.length > 0) {
				await this.vectorDb.addVectors(entries);
			}

			if (showProgress) {
				new Notice(`Successfully indexed ${indexed} notes!`);
			}

			return indexed;

		} catch (error) {
			console.error('Indexing error:', error);
			new Notice(`Indexing failed: ${error.message}`);
			throw error;
		} finally {
			this.isIndexing = false;
		}
	}

	async indexModifiedNotes(): Promise<number> {
		if (this.isIndexing) {
			return 0;
		}

		this.isIndexing = true;
		let indexed = 0;

		try {
			// Get modified notes
			const modifiedFiles = await this.vectorDb.getModifiedNotes();

			if (modifiedFiles.length === 0) {
				return 0;
			}

			console.log(`Found ${modifiedFiles.length} modified notes to index`);

			// Process modified files
			const entries = await this.processBatch(modifiedFiles);

			if (entries.length > 0) {
				await this.vectorDb.addVectors(entries);
				indexed = entries.length;
			}

			return indexed;

		} catch (error) {
			console.error('Incremental indexing error:', error);
			throw error;
		} finally {
			this.isIndexing = false;
		}
	}

	private async processBatch(files: TFile[]): Promise<VectorEntry[]> {
		const entries: VectorEntry[] = [];
		const contents: string[] = [];
		const fileData: Array<{file: TFile, content: string}> = [];

		// Read all files in the batch
		for (const file of files) {
			try {
				const content = await this.app.vault.cachedRead(file);
				const processedContent = this.preprocessContent(content, file);

				if (processedContent.trim()) {
					contents.push(processedContent);
					fileData.push({ file, content: processedContent });
				}
			} catch (error) {
				console.error(`Error reading file ${file.path}:`, error);
			}
		}

		if (contents.length === 0) {
			return entries;
		}

		// Generate embeddings for the batch
		try {
			const embeddings = await this.geminiService.generateEmbeddings(contents);

			// Create vector entries
			for (let i = 0; i < fileData.length; i++) {
				const { file, content } = fileData[i];
				const embedding = embeddings[i];

				if (embedding && embedding.length > 0) {
					entries.push({
						id: file.path,
						embedding: embedding,
						content: content.substring(0, 3000), // Store first 3000 chars for context
						title: file.basename,
						modified: file.stat.mtime,
						tags: this.extractTags(content)
					});
				}
			}
		} catch (error) {
			console.error('Error generating embeddings:', error);
		}

		return entries;
	}

	private preprocessContent(content: string, file: TFile): string {
		// Remove YAML frontmatter
		content = content.replace(/^---[\s\S]*?---\n?/m, '');

		// Remove code blocks (preserve the fact that there was code)
		content = content.replace(/```[\s\S]*?```/g, '[code block]');
		content = content.replace(/`[^`]+`/g, '[inline code]');

		// Remove excessive markdown formatting
		content = content.replace(/^#+\s+/gm, ''); // Remove headers
		content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Convert links to text
		content = content.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[image: $1]'); // Handle images
		content = content.replace(/\*\*([^*]+)\*\*/g, '$1'); // Remove bold
		content = content.replace(/\*([^*]+)\*/g, '$1'); // Remove italic
		content = content.replace(/__([^_]+)__/g, '$1'); // Remove bold
		content = content.replace(/_([^_]+)_/g, '$1'); // Remove italic

		// Add file title at the beginning for better context
		content = `Title: ${file.basename}\nPath: ${file.path}\n\n${content}`;

		// Clean up whitespace
		content = content.replace(/\n{3,}/g, '\n\n'); // Max 2 newlines
		content = content.trim();

		return content;
	}

	private extractTags(content: string): string[] {
		const tags: string[] = [];

		// Extract hashtags
		const hashtagMatches = content.match(/#[\w-]+/g);
		if (hashtagMatches) {
			tags.push(...hashtagMatches.map(tag => tag.substring(1)));
		}

		// Extract frontmatter tags if present
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (frontmatterMatch) {
			const frontmatter = frontmatterMatch[1];
			const tagsMatch = frontmatter.match(/tags:\s*\[(.*?)\]/);
			if (tagsMatch) {
				const tagList = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
				tags.push(...tagList);
			}
		}

		// Remove duplicates
		return [...new Set(tags)];
	}

	async indexSingleNote(file: TFile): Promise<boolean> {
		try {
			const entries = await this.processBatch([file]);
			if (entries.length > 0) {
				await this.vectorDb.addVector(entries[0]);
				return true;
			}
			return false;
		} catch (error) {
			console.error(`Error indexing ${file.path}:`, error);
			return false;
		}
	}

	isCurrentlyIndexing(): boolean {
		return this.isIndexing;
	}
}