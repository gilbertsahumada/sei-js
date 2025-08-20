'use client';
import { useChat } from '@ai-sdk/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export default function Home() {
  const [input, setInput] = useState('');
  const { messages, sendMessage } = useChat();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold text-center mb-8">
          Sei MCP Agent
        </h1>
        <p className="text-center text-gray-600">
          Web interface for interacting with Sei blockchain through MCP server
        </p>
        <div className="border border-border/60 rounded-2xl p-4 bg-card/50 backdrop-blur-sm shadow-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) {
                sendMessage({ text: input });
                setInput('');
              }
            }}
            className="flex gap-3"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 border-0 text-sm h-10 px-4 focus-visible:ring-0 bg-transparent"
            />
            <Button 
              type="submit" 
              disabled={!input.trim()} 
              size="sm" 
              className="h-10 px-6 text-sm font-medium rounded-xl"
            >
              Send
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
