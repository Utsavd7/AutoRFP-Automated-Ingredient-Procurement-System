'use client';
import React from 'react';

interface Props {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
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
        if (process.env.NODE_ENV !== 'production') {
            console.error('QuotePlate render error', error, info.componentStack);
        }
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;
            const detail =
                process.env.NODE_ENV !== 'production' && this.state.error?.message
                    ? this.state.error.message
                    : 'Please try again. Your saved work is still safe.';

            return (
                <div
                    aria-labelledby="error-boundary-heading"
                    aria-live="assertive"
                    className="min-h-screen bg-[#f5f0e7] flex items-center justify-center p-8 text-[#101817]"
                    role="alert"
                >
                    <div className="max-w-md w-full text-center space-y-5">
                        <div className="w-12 h-12 rounded-xl bg-[#d8834f]/15 border border-[#d8834f]/30 flex items-center justify-center mx-auto text-xl" aria-hidden="true">
                            Q
                        </div>
                        <div>
                                <h2 id="error-boundary-heading" className="text-lg font-bold text-[#101817] mb-2">Something went wrong</h2>
                                <p className="text-sm text-[#5d625f] leading-relaxed">
                                    {detail}
                            </p>
                        </div>
                        <div className="flex gap-3 justify-center">
                            <button
                                className="px-4 py-2 rounded-lg bg-[#101817] border border-[#101817] text-sm font-semibold text-[#f5f0e7] hover:bg-[#26312e] transition-colors"
                                onClick={() => this.setState({ hasError: false, error: undefined })}
                                type="button"
                            >
                                Try again
                            </button>
                            <button
                                className="px-4 py-2 rounded-lg bg-transparent border border-[#b8b4ab] text-sm font-semibold text-[#4f5552] hover:text-[#101817] transition-colors"
                                onClick={() => window.location.reload()}
                                type="button"
                            >
                                Reload page
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
