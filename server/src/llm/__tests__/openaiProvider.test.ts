import { beforeEach, describe, expect, it, vi } from 'vitest';

const createCompletion = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: createCompletion,
      },
    };
    models = {
      list: vi.fn(),
    };

    constructor(_options: unknown) {}
  }

  return { default: MockOpenAI };
});

import { OpenAIProvider } from '../openai.js';

describe('OpenAIProvider', () => {
  beforeEach(() => {
    createCompletion.mockReset();
    createCompletion.mockResolvedValue({
      choices: [
        {
          message: { content: '{"agents":[]}' },
          finish_reason: 'stop',
        },
      ],
    });
  });

  it('forwards json schema response_format to the OpenAI SDK', async () => {
    const provider = new OpenAIProvider('test-key', 'gpt-4o');

    await provider.chat(
      [{ role: 'user', content: 'Generate agents' }],
      {
        jsonSchema: {
          name: 'agent_roster',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              agents: { type: 'array' },
            },
            required: ['agents'],
            additionalProperties: false,
          },
        },
      },
    );

    expect(createCompletion).toHaveBeenCalledTimes(1);
    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'agent_roster',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                agents: { type: 'array' },
              },
              required: ['agents'],
              additionalProperties: false,
            },
          },
        },
      }),
    );
  });
});
