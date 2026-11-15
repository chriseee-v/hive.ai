import os

# Read the chat-panel.tsx file
file_path = r'C:\projects\chill.ai\frontend\src\components\chat\chat-panel.tsx'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Add Handy STT state variables after the recording state
old_recording_state = "const [recording, setRecording] = useState(false);"
new_recording_state = """const [recording, setRecording] = useState(false);
  const [handyEnabled, setHandyEnabled] = useState(false);
  const [handyListening, setHandyListening] = useState(false);
  const [handyTranscript, setHandyTranscript] = useState("");"""

content = content.replace(old_recording_state, new_recording_state)

# 2. Add Handy check on mount after the agents fetch
old_agents_fetch = "useEffect(() => { fetch(`${API}/api/agents`).then((r) => { setConnected(r.ok); return r.json(); }).catch(() => setConnected(false)); }, []);"
new_agents_fetch = """useEffect(() => { fetch(`${API}/api/agents`).then((r) => { setConnected(r.ok); return r.json(); }).catch(() => setConnected(false)); }, []);
  // Check Handy STT availability on mount
  useEffect(() => { fetch(`${API}/api/handy/status`).then((r) => r.json()).then((data) => setHandyEnabled(data.available)).catch(() => setHandyEnabled(false)); }, []);"""

content = content.replace(old_agents_fetch, new_agents_fetch)

# 3. Add Handy STT button in the composer area
old_mic_button = '<button type="button" className={cn("grid h-10 w-10 place-items-center bg-card-2", recording && "text-primary")} title="Push to talk" onClick={talk}><Mic size={16} /></button><button type="submit" disabled={!prompt.trim() || busy} className="grid h-10 w-10 place-items-center bg-primary text-primary-foreground disabled:opacity-50">{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={16} />}</button></div>'
new_mic_button = '''<div className="flex gap-2">
{handyEnabled && (
  <div className="flex items-center gap-2">
    <button 
      type="button" 
      className={cn("grid h-10 w-10 place-items-center bg-card-2", handyListening && "text-primary")} 
      title={handyListening ? "Stop Handy STT" : "Start Handy STT"}
      onClick={async () => {
        setHandyListening(!handyListening);
        if (handyListening) {
          setHandyTranscript("");
        } else {
          setHandyTranscript("Press and speak, then release");
        }
      }}
    >
      {handyListening ? <X size={16} /> : <Mic size={16} />}
    </button>
    <span className="text-xs text-muted-foreground">Handy</span>
  </button>
)}
<button type="button" className={cn("grid h-10 w-10 place-items-center bg-card-2", recording && "text-primary")} title="Push to talk" onClick={talk}><Mic size={16} /></button>
<button type="submit" disabled={!prompt.trim() || busy} className="grid h-10 w-10 place-items-center bg-primary text-primary-foreground disabled:opacity-50">{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={16} />}</button>
</div>'''

content = content.replace(old_mic_button, new_mic_button)

# 5. Add handyTranscript display in the task section
old_prompt_display = '{task && <div><div className="ml-auto max-w-xl rounded-2xl bg-card-2 px-5 py-3 text-sm">{task.prompt}</div>'
new_prompt_display = '''{task && <div><div className="ml-auto max-w-xl rounded-2xl bg-card-2 px-5 py-3 text-sm">{task.prompt}</div>
{handyTranscript && <div className="mt-2 text-xs text-muted-foreground">Handy STT: {handyTranscript}</div>}'''

content = content.replace(old_prompt_display, new_prompt_display)

# Write the modified content back
with open(file_path, 'w') as f:
    f.write(content)

print("Frontend Handy integration applied successfully!")
print(f"File modified: {file_path}")