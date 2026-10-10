import { HybridLive } from "../lib/hybrid-live";
import { streamSpeech } from "../lib/openai-direct";

async function main() {
  const input: Buffer[] = [];
  await streamSpeech("Bom dia! Tudo bem com você?", AbortSignal.timeout(20000), async b => { input.push(Buffer.from(b)); }, "marin");
  const pcm = Buffer.concat(input);
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => { live.close(); reject(new Error("Live transcript timeout")); }, 30000);
    const live = new HybridLive(e => {
      if (e.type === "session.updated") {
        live.send(JSON.stringify({type:"input_audio_buffer.clear"}));
        for(let i=0;i<pcm.length;i+=4800)live.send(JSON.stringify({type:"input_audio_buffer.append",audio:pcm.subarray(i,i+4800).toString("base64")}));
        live.send(JSON.stringify({type:"input_audio_buffer.commit"}));
      } else if (e.type === "conversation.item.input_audio_transcription.completed") {
        console.log(JSON.stringify({transcript:e.transcript}));
        void live.nativeSpeech(AbortSignal.timeout(12000)).then(speech=>{
          console.log(JSON.stringify({nativeTranscript:speech?.text,bytes:speech?.chunks.reduce((n,c)=>n+c.length,0)}));
          clearTimeout(deadline);live.close();
          if(!speech)reject(new Error("Missing native speech"));else resolve();
        }).catch(reject);
      } else if (e.type === "error") {clearTimeout(deadline);live.close();reject(new Error(e.error?.code));}
    },()=>{}, "bossa",(_usage,complete)=>console.log(JSON.stringify({usageFinalized:complete})));
  });
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Failed");process.exitCode=1;});
