import React, { useState } from 'react';
import { 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { LogIn, Mail, Lock, User, Github, Chrome, Loader2, Sparkles, AlertCircle, Download, Layers, Zap, RefreshCw, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const Login: React.FC = () => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) {
          await updateProfile(userCredential.user, { displayName });
        }
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4 relative overflow-hidden">
      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
            x: [0, 50, 0],
            y: [0, -30, 0]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-accent/10 rounded-full blur-[120px]"
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.3, 1],
            rotate: [0, -120, 0],
            x: [0, -60, 0],
            y: [0, 40, 0]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute -bottom-[10%] -right-[10%] w-[60%] h-[60%] bg-purple-500/10 rounded-full blur-[140px]"
        />
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-5xl glass border border-border/60 shadow-2xl rounded-[3rem] overflow-hidden flex flex-col md:flex-row z-10 relative"
      >
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-accent via-purple-500 to-accent"></div>

        {/* Left Side: Branding & Visuals */}
        <div className="md:w-1/2 p-12 bg-gradient-to-br from-accent to-purple-600 text-white flex flex-col justify-between relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid-white" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid-white)" />
            </svg>
          </div>
          
          <div className="relative z-10">
            <motion.div 
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex items-center gap-4 mb-16"
            >
              <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/30 shadow-xl">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <div>
                <h2 className="text-3xl font-black tracking-tight uppercase leading-none">MetaZo</h2>
                <div className="text-[10px] font-black uppercase tracking-[0.4em] mt-1 opacity-60">Neural Systems</div>
              </div>
            </motion.div>

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="space-y-8"
            >
              <h1 className="text-6xl font-black leading-[0.95] tracking-tighter">
                OPTIMIZE <br/> 
                <span className="text-white/60 italic font-medium">NEURAL</span> <br/>
                PIPELINES.
              </h1>
              <p className="text-sm font-bold text-white/80 max-w-xs leading-relaxed uppercase tracking-wider">
                Microstock Intelligence. Automated Metadata. AI Market Synthesis. 
              </p>
            </motion.div>
          </div>

          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="relative z-10 grid grid-cols-2 gap-4 mt-12 font-mono"
          >
            {[
              { label: 'SEO ARCHITECTURE', icon: Zap, value: 'DEPLOYED' },
              { label: 'MARKET DEFENSE', icon: Shield, value: 'ACTIVE' }
            ].map((stat, i) => (
              <div key={i} className="bg-white/10 backdrop-blur-md border border-white/20 p-5 rounded-[1.5rem] shadow-lg">
                <stat.icon className="w-5 h-5 mb-3 text-white" />
                <div className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-1">{stat.label}</div>
                <div className="text-xs font-black tracking-tighter">{stat.value}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Right Side: Auth Forms */}
        <div className="md:w-1/2 p-12 lg:p-16 bg-surface/40 backdrop-blur-xl flex flex-col justify-center relative">
          <div className="max-w-sm mx-auto w-full space-y-10">
            <div className="space-y-3">
              <h3 className="text-xs font-black text-accent uppercase tracking-[0.3em]">Protocol Alpha</h3>
              <div className="space-y-1">
                <h3 className="text-4xl font-black text-text-primary tracking-tighter uppercase">
                  {isRegistering ? 'New Operator' : 'Access Link'}
                </h3>
                <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">
                  Secure Identity Synchronization
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-4 px-6 py-5 bg-white dark:bg-slate-900 border border-border/80 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] text-text-primary shadow-xl shadow-accent/5 hover:shadow-accent/10 transition-all disabled:opacity-50"
              >
                <Chrome className="w-5 h-5 text-accent" />
                Initialize Identity
              </motion.button>

              <div className="relative flex items-center gap-4 py-2">
                <div className="flex-1 h-px bg-border/40"></div>
                <span className="text-[9px] font-black text-text-secondary uppercase tracking-[0.3em] opacity-40">Or Manual</span>
                <div className="flex-1 h-px bg-border/40"></div>
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-5">
                <AnimatePresence mode="wait">
                  {isRegistering && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                    >
                      <div className="relative group">
                        <User className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary group-focus-within:text-accent transition-colors" />
                        <input
                          type="text"
                          placeholder="FULL NAME"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="w-full pl-14 pr-6 py-4 bg-subtle/20 border border-border/80 rounded-2xl focus:outline-none focus:border-accent font-black text-[11px] text-text-primary placeholder:text-text-secondary/40 placeholder:font-black tracking-widest transition-all shadow-inner"
                          required={isRegistering}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="relative group">
                  <Mail className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary group-focus-within:text-accent transition-colors" />
                  <input
                    type="email"
                    placeholder="NETWORK ADDRESS"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-14 pr-6 py-4 bg-subtle/20 border border-border/80 rounded-2xl focus:outline-none focus:border-accent font-black text-[11px] text-text-primary placeholder:text-text-secondary/40 placeholder:font-black tracking-widest transition-all shadow-inner"
                    required
                  />
                </div>

                <div className="relative group">
                  <Lock className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary group-focus-within:text-accent transition-colors" />
                  <input
                    type="password"
                    placeholder="SECURITY KEY"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-14 pr-6 py-4 bg-subtle/20 border border-border/80 rounded-2xl focus:outline-none focus:border-accent font-black text-[11px] text-text-primary placeholder:text-text-secondary/40 placeholder:font-black tracking-widest transition-all shadow-inner"
                    required
                  />
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl text-[10px] font-black uppercase tracking-wider"
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </motion.div>
                )}

                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-5 bg-accent text-white rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-[11px] shadow-2xl shadow-accent/25 hover:opacity-90 transition-all flex items-center justify-center gap-3 active:scale-95"
                >
                  {loading ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <LogIn className="w-5 h-5" />
                      {isRegistering ? 'Register Protocol' : 'Deploy Identity'}
                    </>
                  )}
                </motion.button>
              </form>
            </div>

            <div className="pt-8 text-center">
              <p className="text-text-secondary text-[10px] font-black uppercase tracking-[0.2em]">
                {isRegistering ? 'Already operational?' : 'New system operator?'}
                <button 
                  onClick={() => setIsRegistering(!isRegistering)}
                  className="ml-3 text-accent hover:underline decoration-2 underline-offset-4"
                >
                  {isRegistering ? 'Decrypt Login' : 'Create Access'}
                </button>
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="absolute bottom-8 left-0 w-full text-center text-text-secondary/50 text-[10px] font-black uppercase tracking-[0.2em] pointer-events-none">
        &copy; {new Date().getFullYear()} MetaZo Labs &bull; Production Grade AI
      </div>
    </div>
  );
};
