'use client';
import { useChat } from '@ai-sdk/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Bot, User } from 'lucide-react';

export default function Home() {
  const [input, setInput] = useState('');
  const { messages, sendMessage } = useChat();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                Sei MCP Agent
              </h1>
              <p className="text-sm text-slate-600">
                Arbitrage Assistant for Sei Blockchain
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Container */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 overflow-hidden">
          
          {/* Messages Area */}
          <div className="h-[500px] overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl flex items-center justify-center mb-4">
                  <Bot className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  Welcome to Sei MCP Agent
                </h3>
                <p className="text-slate-600 max-w-md">
                  I'm your specialized assistant for arbitrage opportunities on the Sei blockchain. 
                  Ask me about DEX prices, trading strategies, or risk management.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {/* Avatar */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    message.role === 'user' 
                      ? 'bg-gradient-to-br from-blue-500 to-indigo-600' 
                      : 'bg-gradient-to-br from-slate-600 to-slate-700'
                  }`}>
                    {message.role === 'user' ? (
                      <User className="w-4 h-4 text-white" />
                    ) : (
                      <Bot className="w-4 h-4 text-white" />
                    )}
                  </div>

                  {/* Message Bubble */}
                  <div className={`max-w-[75%] ${
                    message.role === 'user' 
                      ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' 
                      : 'bg-white border border-slate-200 text-slate-900'
                  } rounded-2xl px-4 py-3 shadow-sm`}>
                    <div className="space-y-2">
                      {message.parts.map((part, i) => 
                        part.type === 'text' ? (
                          <div key={`${message.id}-${i}`} className="text-sm leading-relaxed whitespace-pre-wrap">
                            {part.text}
                          </div>
                        ) : null
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Input Area */}
          <div className="p-6 bg-slate-50/50 border-t border-slate-200/60">
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
              <div className="flex-1 relative">
                <Input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about arbitrage opportunities, DEX prices, or trading strategies..."
                  className="pr-12 bg-white border-slate-300 focus:border-blue-500 focus:ring-blue-500/20 placeholder:text-slate-500"
                />
              </div>
              <Button
                type="submit"
                disabled={!input.trim()}
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 px-6"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
            
            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2 mt-4">
              {[
                'Check DragonSwap prices',
                'Explain arbitrage risks',
                'Best DEX for swapping',
                'Current SEI market analysis'
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-full transition-colors hover:border-slate-300"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-sm text-slate-500">
          <p>Powered by Sei MCP Server • Always verify trades and manage risk responsibly</p>
        </div>
      </div>
    </div>
  );
}