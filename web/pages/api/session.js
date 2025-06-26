// Next.js API route for generating ephemeral OpenAI client tokens

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('OPENAI_API_KEY environment variable is not set');
        return res.status(500).json({ 
            error: 'Server configuration error',
            message: 'OpenAI API key not configured' 
        });
    }

    try {
        const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-realtime-preview-2025-06-03',
                voice: 'alloy'
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenAI API error:', response.status, errorText);
            return res.status(response.status).json({
                error: 'OpenAI API error',
                message: `Failed to generate session token: ${response.status} ${errorText}`
            });
        }

        const data = await response.json();
        
        // Extract the actual client secret value for WebRTC
        const clientSecret = data.client_secret?.value || data.client_secret;
        
        // Return the client token and session info
        res.json({
            client_secret: clientSecret,
            session_id: data.id,
            expires_at: data.expires_at
        });

    } catch (error) {
        console.error('Error generating ephemeral token:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}