import type { Profile } from '../../shared/types';

/**
 * LLM client — generates answers for open-ended application questions.
 *
 * MVP: returns a dummy string. Custom questions are not filled yet; the
 * service worker only logs this output.
 *
 * TODO: call a real model. Sketch for an OpenAI-compatible chat endpoint:
 *
 *   const res = await fetch('https://api.openai.com/v1/chat/completions', {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       Authorization: `Bearer ${LLM_API_KEY}`,
 *     },
 *     body: JSON.stringify({
 *       model: LLM_MODEL,
 *       messages: [
 *         { role: 'system', content: 'Answer job application questions concisely, in first person, using only the candidate background provided.' },
 *         { role: 'user', content: `Background:\n${profile.resumeText}\n\nQuestion: ${question}` },
 *       ],
 *       max_tokens: 300,
 *     }),
 *   });
 *   const json = await res.json();
 *   return json.choices[0].message.content;
 */
export const LLM_API_KEY = 'YOUR_LLM_API_KEY';
export const LLM_MODEL = 'YOUR_MODEL_NAME';

export async function generateAnswer(question: string, profile: Profile): Promise<string> {
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'the candidate';
  return `[LLM placeholder] Draft answer for ${name} to: "${question.slice(0, 80)}"`;
}
