# Gemini Vector Chat Plugin for Obsidian

This plugin allows you to chat with your Obsidian notes using Google's Gemini AI. It creates a vector database of your notes for semantic search and provides an intelligent chatbot interface.

## Features

- **Vector Search**: Creates embeddings of all your notes for semantic search
- **AI Chat Interface**: Chat with Gemini AI about your notes
- **Local Storage**: All vector embeddings are stored locally
- **Smart Context**: Automatically finds relevant notes to answer your questions
- **Real-time Indexing**: Index your notes on demand or automatically


### To enable the plugin:

1. Open Obsidian Settings (Cmd/Ctrl + ,)
2. Go to "Community plugins"
3. Make sure "Restricted mode" is turned OFF
4. Click "Reload plugins" or restart Obsidian
5. Find "Gemini Vector Chat" in the list and toggle it ON

## ⚠️ IMPORTANT: API Key Required

**You must provide your own Gemini API key for this plugin to work.**

## Initial Setup

1. **Get a Gemini API Key** (REQUIRED):
   - Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Click "Get API Key" or "Create API Key"
   - Copy your API key (keep it secret!)

2. **Configure API Key in Obsidian**:
   - Go to Settings → Gemini Vector Chat
   - Paste your API key in the "Gemini API Key" field
   - The key will be stored securely in your local vault
   - **NEVER share or commit your API key to version control**

3. **Index Your Notes**:
   - Click the Gemini Chat icon in the left sidebar
   - Click "Index Notes" button to create embeddings for all your notes
   - This may take a few minutes depending on vault size

4. **Start Chatting**:
   - Type your question in the chat input
   - Press Enter or click Send
   - Gemini will search your notes and provide contextual answers

## Usage

### Chat Commands
- **Clear Chat**: Removes all messages from current session
- **Index Notes**: Re-indexes all notes (useful after adding new content)

### Settings
- **Chat Model**: Choose between Gemini 1.5 Flash (fast) or Pro (more capable)
- **Temperature**: Control response creativity (0 = deterministic, 1 = creative)
- **Search Results**: Number of relevant notes to include (1-20)
- **Auto-index**: Automatically index new notes on startup
- **Debug Info**: Show which notes were used to answer questions

## How It Works

1. **Indexing**: The plugin reads all your markdown notes and generates vector embeddings using Gemini's embedding model
2. **Storage**: Embeddings are stored locally in `.obsidian/plugins/gemini-vector-chat/vectors.json`
3. **Search**: When you ask a question, it's converted to an embedding and compared with all note embeddings
4. **Context**: The most similar notes are retrieved and sent to Gemini as context
5. **Response**: Gemini generates an answer based on your notes' content

## Tips

- Keep your notes well-organized with clear titles for better search results
- Use tags and headers in your notes for better context
- Re-index periodically after adding significant new content
- The plugin works best with descriptive, well-written notes

## Troubleshooting

### Plugin not showing up:
- Make sure you've reloaded plugins or restarted Obsidian
- Check that restricted mode is OFF
- Verify the plugin files are in the correct directory

### Indexing fails:
- Check your internet connection
- Verify your API key is valid
- Try indexing fewer notes at once

### Chat not responding:
- Ensure notes are indexed first
- Check API key configuration
- Look for error messages in Developer Console (Ctrl+Shift+I)

## API Usage

This plugin uses the Google Gemini API. Be aware of:
- Free tier limits (check Google AI Studio for current limits)
- Each indexing operation uses API calls for embeddings
- Each chat message uses API calls for generation

## Privacy

- All data is stored locally in your vault
- Only the text content is sent to Google's API for processing
- No data is stored on external servers (except standard Google API usage)

## Development

To modify the plugin:
1. Edit TypeScript files in `src/` directory
2. Run `npm run dev` for development mode
3. Run `npm run build` to compile for production

## Support

For issues or questions:
- Check the plugin settings and this README
- Review the debug information in chat (enable in settings)
- Check the Obsidian Developer Console for errors

Enjoy chatting with your notes!