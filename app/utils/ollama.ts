interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

const OLLAMA_API_URL = '/ollama/generate';

export async function generateScript(prompt: string, model: string = 'mistral'): Promise<string> {
  try {
    const response = await fetch(OLLAMA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data: OllamaResponse = await response.json();
    return data.response;
  } catch (error) {
    console.error('Error calling Ollama:', error);
    throw error;
  }
}

export function isOllamaAvailable(): Promise<boolean> {
  return fetch('/ollama/version')
    .then(() => true)
    .catch(() => false);
} 