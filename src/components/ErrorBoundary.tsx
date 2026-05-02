'use client';
import React from 'react';
import * as Sentry from '@sentry/nextjs';

interface Props {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
    eventId?: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        const eventId = Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
        this.setState({ eventId });
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <div className="min-h-screen bg-black flex items-center justify-center p-8">
                    <div className="max-w-md w-full text-center space-y-5">
                        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-xl">
                            ⚡
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-[#EEEEEE] mb-2">Something went wrong</h2>
                            <p className="text-sm text-[#8A8F98] leading-relaxed">
                                {this.state.error?.message ?? 'An unexpected error occurred'}
                            </p>
                        </div>
                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={() => this.setState({ hasError: false })}
                                className="px-4 py-2 rounded-lg bg-violet-500/20 border border-violet-500/30 text-sm font-semibold text-violet-300 hover:bg-violet-500/30 transition-colors"
                            >
                                Try again
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm font-semibold text-[#8A8F98] hover:text-[#EEEEEE] transition-colors"
                            >
                                Reload page
                            </button>
                        </div>
                        {this.state.eventId && (
                            <p className="text-[10px] font-mono text-[#8A8F98]/50">
                                Error ID: {this.state.eventId}
                            </p>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
