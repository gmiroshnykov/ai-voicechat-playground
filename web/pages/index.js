import Head from 'next/head';
import VoiceChatApp from '../components/VoiceChatApp';

export default function Home() {
    return (
        <>
            <Head>
                <title>AI Voice Chat</title>
                <meta name="description" content="AI voice chat using OpenAI Agents SDK" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
                <link rel="icon" href="/favicon.ico" sizes="any" />
            </Head>
            
            <VoiceChatApp />
        </>
    );
}