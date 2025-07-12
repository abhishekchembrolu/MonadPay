"use client";

import React, { useState, useRef, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { PublicKey, Connection, SystemProgram, Transaction } from '@solana/web3.js';

// Extend Window interface for Phantom
declare global {
  interface Window {
    solana?: any;
  }
}

function isValidEthAddress(address: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isValidSolAddress(address: string) {
  // Solana: base58, 32 or 44 chars, allowed chars: 1-9A-HJ-NP-Za-km-z (no 0, O, I, l)
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function isValidAmount(amount: string) {
  const num = Number(amount);
  return !isNaN(num) && num > 0;
}

const COMMON_TOKENS = [
  { label: 'USDC', value: 'USDC' },
  { label: 'USDT', value: 'USDT' },
  { label: 'ETH', value: 'ETH' },
  { label: 'SOL', value: 'SOL' },
  { label: 'Custom', value: 'custom' },
];

export default function Home() {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('USDC');
  const [customToken, setCustomToken] = useState('');
  const [deeplink, setDeeplink] = useState('');
  const [copied, setCopied] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'send' | 'request'>('send');
  const [showSummary, setShowSummary] = useState(false);
  const [shareMsg, setShareMsg] = useState('');
  const [shareQRMsg, setShareQRMsg] = useState('');
  const [phantomConnected, setPhantomConnected] = useState(false);
  const [phantomAddress, setPhantomAddress] = useState('');
  const [phantomNotFound, setPhantomNotFound] = useState(false);
  const [useOtherWallet, setUseOtherWallet] = useState(false);
  const [otherWalletAddress, setOtherWalletAddress] = useState('');
  const [txStatus, setTxStatus] = useState<{ success: boolean; message: string; signature?: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  // Load history from localStorage after mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('monadpay-history') || '[]');
      setHistory(stored);
    } catch {}
  }, []);
  const [networkWarning, setNetworkWarning] = useState('');
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  // Load recent recipients from localStorage after mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('monadpay-recents') || '[]');
      setRecents(stored);
    } catch {}
  }, []);
  // Save new recipient to recents
  useEffect(() => {
    if (to && (isValidEthAddress(to) || isValidSolAddress(to))) {
      setRecents(prev => {
        if (prev.includes(to)) return prev;
        const updated = [to, ...prev].slice(0, 10);
        localStorage.setItem('monadpay-recents', JSON.stringify(updated));
        return updated;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deeplink]);

  // Phantom connect logic
  const connectPhantom = async () => {
    if (typeof window === 'undefined' || !window.solana || !window.solana.isPhantom) {
      setPhantomNotFound(true);
      return;
    }
    try {
      const resp = await window.solana.connect();
      setPhantomAddress(resp.publicKey?.toString() || '');
      setPhantomConnected(true);
      setPhantomNotFound(false);
    } catch (e) {
      setPhantomConnected(false);
    }
  };

  // Helper to get sender address
  const getSenderAddress = () => {
    if (phantomConnected && phantomAddress) return phantomAddress;
    if (useOtherWallet && otherWalletAddress) return otherWalletAddress;
    return '';
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    setAddressError('');
    setAmountError('');
    const trimmedTo = to.trim();
    if (!isValidEthAddress(trimmedTo) && !isValidSolAddress(trimmedTo)) {
      setAddressError('Invalid Ethereum or Solana address.');
      setDeeplink('');
      return;
    }
    if (!isValidAmount(amount)) {
      setAmountError('Amount must be a positive number.');
      setDeeplink('');
      return;
    }
    let tokenValue = token === 'custom' ? customToken.trim() : token;
    if (!tokenValue) return;
    // Optionally require sender address if neither Phantom nor fallback is set
    // if (!getSenderAddress()) return;
    setShowSummary(true);
  };

  const handleConfirm = async () => {
    const trimmedTo = to.trim();
    let tokenValue = token === 'custom' ? customToken.trim() : token;
    const sender = getSenderAddress();
    const prefix = tab === 'send' ? 'send' : 'request';
    let link = `monadpay://${prefix}?to=${encodeURIComponent(trimmedTo)}&amount=${encodeURIComponent(amount)}&token=${encodeURIComponent(tokenValue)}`;
    if (sender) link += `&from=${encodeURIComponent(sender)}`;
    setDeeplink(link);
    setCopied(false);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
    setShowSummary(false);

    // Only attempt Phantom transaction signing if Phantom is connected and token is SOL
    if (tab === 'send' && phantomConnected && tokenValue.toUpperCase() === 'SOL') {
      try {
        setTxStatus(null);
        setIsLoading(true);
        const connection = new Connection('https://api.devnet.solana.com');
        const fromPubkey = new PublicKey(phantomAddress);
        const toPubkey = new PublicKey(trimmedTo);
        const lamports = Math.floor(Number(amount) * 1e9); // 1 SOL = 1e9 lamports
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey,
            toPubkey,
            lamports,
          })
        );
        transaction.feePayer = fromPubkey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        // Sign and send with Phantom
        const signed = await window.solana.signTransaction(transaction);
        const sig = await connection.sendRawTransaction(signed.serialize());
        setTxStatus({ success: true, message: 'Transaction sent!', signature: sig });
        setIsLoading(false);
      } catch (e: any) {
        let msg = 'Transaction failed.';
        if (e?.message?.includes('0x1')) msg = 'Insufficient funds for transaction.';
        else if (e?.message?.toLowerCase().includes('user rejected')) msg = 'Transaction rejected by user.';
        else if (e?.message?.toLowerCase().includes('network')) msg = 'Network error. Please check your connection.';
        else if (e?.message) msg = e.message;
        setTxStatus({ success: false, message: msg });
        setIsLoading(false);
      }
    }
  };

  const handleEdit = () => {
    setShowSummary(false);
  };

  const handleCopy = async () => {
    if (deeplink) {
      await navigator.clipboard.writeText(deeplink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleDownloadQR = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (canvas) {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'monadpay-qr.png';
      a.click();
    }
  };

  const handleShareLink = async () => {
    if (!deeplink) return;
    const shareData = {
      title: 'MonadPay Link',
      text: 'Pay or request crypto with MonadPay:',
      url: deeplink,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (e) {
        // User cancelled or error
      }
    } else {
      await navigator.clipboard.writeText(deeplink);
      setShareMsg('Link copied to clipboard!');
      setTimeout(() => setShareMsg(''), 1500);
    }
  };

  const handleShareQR = async () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const file = await (async () => {
      const res = await fetch(url);
      const blob = await res.blob();
      return new File([blob], 'monadpay-qr.png', { type: 'image/png' });
    })();
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file], title: 'MonadPay QR', text: 'Scan to pay or request crypto with MonadPay.' });
        return;
      } catch (e) {
        // User cancelled or error
      }
    }
    // Fallback: try to copy image to clipboard (if supported)
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new window.ClipboardItem({ 'image/png': file })
        ]);
        setShareQRMsg('QR image copied to clipboard!');
        setTimeout(() => setShareQRMsg(''), 1500);
        return;
      } catch (e) {}
    }
    // Fallback: prompt user to download and share manually
    setShareQRMsg('Sharing not supported. Please download and share the QR image.');
    setTimeout(() => setShareQRMsg(''), 2000);
  };

  // Reset form and output when switching tabs
  const handleTabChange = (newTab: 'send' | 'request') => {
    setTab(newTab);
    setTo('');
    setAmount('');
    setToken('USDC');
    setCustomToken('');
    setDeeplink('');
    setCopied(false);
    setAddressError('');
    setAmountError('');
    setTxStatus(null); // Reset transaction status
  };

  // Add to history on transaction status change
  useEffect(() => {
    if (txStatus && (txStatus.success || txStatus.success === false)) {
      const entry = {
        time: new Date().toISOString(),
        type: tab,
        recipient: to,
        amount,
        token: token === 'custom' ? customToken : token,
        sender: getSenderAddress(),
        status: txStatus.success ? 'Success' : 'Error',
        message: txStatus.message,
        signature: txStatus.signature,
      };
      setHistory(prev => {
        const updated = [entry, ...prev].slice(0, 10); // keep last 10
        localStorage.setItem('monadpay-history', JSON.stringify(updated));
        return updated;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txStatus]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      {showSuccess && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 bg-green-500 dark:bg-green-600 text-white px-6 py-2 rounded shadow-lg z-50 transition-opacity animate-fade-in-out">
          Deeplink generated!
        </div>
      )}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 w-full max-w-md">
        {/* Phantom Wallet Connect */}
        <div className="flex justify-end mb-4">
          {phantomConnected ? (
            <div className="text-xs text-green-600 dark:text-green-400 font-mono bg-green-50 dark:bg-green-900 px-3 py-1 rounded-lg">
              Connected: {phantomAddress.slice(0, 6)}...{phantomAddress.slice(-4)}
            </div>
          ) : (
            <>
              <button
                onClick={connectPhantom}
                className="px-4 py-1 bg-purple-600 text-white rounded-lg font-semibold shadow hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-400 transition text-xs"
                type="button"
              >
                Connect Phantom Wallet
              </button>
              {phantomNotFound && (
                <a
                  href="https://phantom.app/download"
            target="_blank"
            rel="noopener noreferrer"
                  className="ml-2 text-xs text-blue-600 dark:text-blue-300 underline"
                >
                  Install Phantom
                </a>
              )}
              {!useOtherWallet && (
                <button
                  onClick={() => setUseOtherWallet(true)}
                  className="ml-2 px-4 py-1 bg-gray-200 dark:bg-gray-700 text-black dark:text-white rounded-lg font-semibold shadow hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition text-xs"
                  type="button"
                >
                  Use another wallet
                </button>
              )}
            </>
          )}
        </div>
        {/* Fallback wallet address input */}
        {!phantomConnected && useOtherWallet && (
          <div className="mb-4">
            <label htmlFor="other-wallet-address" className="block text-xs font-medium mb-1 text-black dark:text-gray-200">Your Wallet Address</label>
            <input
              id="other-wallet-address"
              type="text"
              className="w-full border rounded-lg px-3 py-2 text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
              value={otherWalletAddress}
              onChange={e => setOtherWalletAddress(e.target.value)}
              placeholder="Enter your wallet address"
              required
            />
          </div>
        )}
        {/* Tabs */}
        <div className="flex mb-6">
          <button
            className={`flex-1 py-2 rounded-t-lg font-semibold transition-colors ${tab === 'send' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white'}`}
            onClick={() => handleTabChange('send')}
            type="button"
          >
            Send
          </button>
          <button
            className={`flex-1 py-2 rounded-t-lg font-semibold transition-colors ${tab === 'request' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white'}`}
            onClick={() => handleTabChange('request')}
            type="button"
          >
            Request
          </button>
        </div>
        <h1 className="text-2xl font-bold mb-6 text-center text-black dark:text-white">MonadPay: {tab === 'send' ? 'Send' : 'Request'} Crypto</h1>
        <h2 className="text-lg font-semibold text-black dark:text-white mb-4">Payment Details</h2>
        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <label htmlFor="recipient-address" className="block text-sm font-medium mb-1 text-black dark:text-gray-200">Recipient Address</label>
            <div className="flex gap-2 items-center">
              <input
                id="recipient-address"
                type="text"
                className={`w-full border rounded-lg px-3 py-2 text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition ${addressError ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'}`}
                value={to}
                onChange={e => setTo(e.target.value)}
                placeholder="0x... or Solana address"
                required
                aria-label="Recipient Address"
                aria-describedby={addressError ? 'recipient-address-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowQRScanner(true)}
                className="p-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 shadow focus:outline-none focus:ring-2 focus:ring-blue-400 transition text-xs"
                aria-label="Scan QR for address"
              >
                📷 Scan QR
              </button>
            </div>
            {recents.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-2">
                {recents.map(addr => (
                  <button
                    key={addr}
                    type="button"
                    onClick={() => setTo(addr)}
                    className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs rounded hover:bg-blue-100 dark:hover:bg-blue-800 border border-gray-200 dark:border-gray-600 text-black dark:text-white"
                  >
                    {addr.slice(0, 8)}...{addr.slice(-4)}
                  </button>
                ))}
              </div>
            )}
            {addressError && <div id="recipient-address-error" className="text-red-600 dark:text-red-400 text-xs mt-1" role="alert">{addressError}</div>}
          </div>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium mb-1 text-black dark:text-gray-200">Amount</label>
            <input
              id="amount"
              type="number"
              className={`w-full border rounded-lg px-3 py-2 text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition ${amountError ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'}`}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="1.0"
              min="0"
              step="any"
              required
              aria-label="Amount"
              aria-describedby={amountError ? 'amount-error' : undefined}
            />
            {amountError && <div id="amount-error" className="text-red-600 dark:text-red-400 text-xs mt-1" role="alert">{amountError}</div>}
          </div>
          <div>
            <label htmlFor="token" className="block text-sm font-medium mb-1 text-black dark:text-gray-200">Token</label>
            <select
              id="token"
              className="w-full border rounded-lg px-3 py-2 text-black dark:text-white bg-white dark:bg-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition border-gray-300 dark:border-gray-600"
              value={token}
              onChange={e => setToken(e.target.value)}
              aria-label="Token"
            >
              {COMMON_TOKENS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {token === 'custom' && (
              <input
                id="custom-token"
                type="text"
                className="w-full border rounded-lg px-3 py-2 text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 mt-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
                value={customToken}
                onChange={e => setCustomToken(e.target.value)}
                placeholder="Enter custom token symbol"
                required
                aria-label="Custom Token Symbol"
              />
            )}
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 dark:bg-blue-500 text-white py-2 rounded-lg font-semibold shadow hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 transition"
          >
            Generate Deeplink & QR
          </button>
        </form>
        {/* Transaction summary before generating deeplink/QR */}
        {showSummary && (
          <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded p-4 mt-4">
            <div className="font-semibold mb-2 text-black dark:text-white">Confirm Transaction Details</div>
            {getSenderAddress() && (
              <div className="text-sm text-black dark:text-gray-200 mb-1"><span className="font-medium">Sender:</span> {getSenderAddress()}</div>
            )}
            <div className="text-sm text-black dark:text-gray-200 mb-1"><span className="font-medium">Type:</span> {tab === 'send' ? 'Send' : 'Request'}</div>
            <div className="text-sm text-black dark:text-gray-200 mb-1"><span className="font-medium">Recipient:</span> {to}</div>
            <div className="text-sm text-black dark:text-gray-200 mb-1"><span className="font-medium">Amount:</span> {amount}</div>
            <div className="text-sm text-black dark:text-gray-200 mb-3"><span className="font-medium">Token:</span> {token === 'custom' ? customToken : token}</div>
            <div className="flex gap-2">
              <button
                onClick={handleConfirm}
                className="flex-1 bg-blue-600 dark:bg-blue-500 text-white py-2 rounded-lg font-semibold shadow hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 transition"
                type="button"
              >
                Confirm
              </button>
              <button
                onClick={handleEdit}
                className="flex-1 bg-gray-200 dark:bg-gray-700 text-black dark:text-white py-2 rounded-lg font-semibold shadow hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 transition"
                type="button"
              >
                Edit
              </button>
            </div>
          </div>
        )}
        {txStatus && (
          <div className={`mt-4 p-3 rounded-lg text-xs font-medium ${txStatus.success ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'}`}>
            {txStatus.success ? (
              <>
                ✅ {txStatus.message}
                {txStatus.signature && (
                  <>
                    <br />
                    <a
                      href={`https://explorer.solana.com/tx/${txStatus.signature}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
                      className="underline text-blue-600 dark:text-blue-300"
                    >
                      View on Solana Explorer
                    </a>
                  </>
                )}
              </>
            ) : (
              <>❌ {txStatus.message}</>
            )}
          </div>
        )}
        {isLoading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-blue-600 dark:text-blue-300 text-sm font-medium">
            <svg className="animate-spin h-5 w-5 mr-2 text-blue-600 dark:text-blue-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
            Sending transaction…
          </div>
        )}
        {deeplink && <hr className="my-8 border-gray-200 dark:border-gray-700" />}
        {deeplink && (
          <div className="mt-6">
            <div className="mb-2 text-sm font-medium text-black dark:text-gray-200 flex items-center gap-2">
              Deeplink:
              <button
                onClick={handleCopy}
                className="ml-2 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 shadow focus:outline-none focus:ring-2 focus:ring-blue-400 transition text-black dark:text-white"
                type="button"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="bg-gray-100 dark:bg-gray-900 rounded p-2 break-all text-xs text-black dark:text-white">{deeplink}</div>
            <button
              onClick={handleShareLink}
              className="mt-2 px-4 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg font-medium shadow hover:bg-blue-200 dark:hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400 transition text-xs"
              type="button"
            >
              Share Link
            </button>
            {shareMsg && <div className="text-green-600 dark:text-green-400 text-xs mt-1">{shareMsg}</div>}
            <div className="mt-4 flex flex-col items-center" ref={qrRef}>
              <QRCodeCanvas value={deeplink} size={128} />
              <button
                onClick={handleDownloadQR}
                className="mt-3 px-4 py-1 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 text-xs text-black dark:text-white shadow focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
                type="button"
              >
                Download QR
              </button>
              <button
                onClick={handleShareQR}
                className="mt-2 px-4 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg font-medium shadow hover:bg-blue-200 dark:hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400 transition text-xs"
                type="button"
              >
                Share QR
              </button>
              {shareQRMsg && <div className="text-green-600 dark:text-green-400 text-xs mt-1">{shareQRMsg}</div>}
            </div>
          </div>
        )}
      </div>
      {/* Transaction History */}
      {history.length > 0 && (
        <div className="mt-10 max-w-md w-full mx-auto">
          <h3 className="text-lg font-semibold mb-2 text-black dark:text-white">Transaction History</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-xs">
            {history.map((h, i) => (
              <div key={i} className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700 last:mb-0 last:pb-0 last:border-0">
                <div className="mb-1">
                  <span className="font-medium">{h.type === 'send' ? 'Send' : 'Request'}</span> | <span className={h.status === 'Success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{h.status}</span> | <span>{new Date(h.time).toLocaleString()}</span>
                </div>
                <div><span className="font-medium">To:</span> {h.recipient}</div>
                <div><span className="font-medium">Amount:</span> {h.amount} {h.token}</div>
                {h.sender && <div><span className="font-medium">From:</span> {h.sender}</div>}
                {h.signature && (
                  <div>
                    <a href={`https://explorer.solana.com/tx/${h.signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="underline text-blue-600 dark:text-blue-300">View on Explorer</a>
                  </div>
                )}
                <div className="text-gray-500 dark:text-gray-400">{h.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* QR Scanner Modal (placeholder) */}
      {showQRScanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 relative w-80 max-w-full">
            <button onClick={() => setShowQRScanner(false)} className="absolute top-2 right-2 text-lg font-bold text-gray-500 hover:text-gray-800 dark:hover:text-white">×</button>
            <div className="mb-2 text-black dark:text-white font-semibold">Scan QR Code (coming soon)</div>
            <div className="w-64 h-64 mx-auto flex items-center justify-center bg-gray-100 dark:bg-gray-900 rounded">Camera here</div>
          </div>
    </div>
      )}
    </main>
  );
}

// Add a simple fade-in-out animation for the toast
// Add this to your global CSS if not already present:
// @keyframes fade-in-out { 0% { opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { opacity: 0; } }
// .animate-fade-in-out { animation: fade-in-out 2s linear; }
