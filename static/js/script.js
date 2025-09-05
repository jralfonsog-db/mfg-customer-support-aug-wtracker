// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Form submission handling
    const transcriptForm = document.getElementById('transcript-form');
    const processingIndicator = document.getElementById('processing-indicator');
    const aiResponseContainer = document.getElementById('ai-response-container');
    const processButton = document.getElementById('process-button');

    // Audio recording elements
    const micButton = document.getElementById('mic-button');
    const recordingStatus = document.getElementById('recording-status');
    const recordingTime = document.getElementById('recording-time');

    // Demo mode elements
    const demoModeButton = document.getElementById('demo-mode-button');
    const demoButtonsContainer = document.getElementById('demo-buttons-container');
    const turn1Button = document.getElementById('turn1-button');
    const turn2Button = document.getElementById('turn2-button');
    const turn3Button = document.getElementById('turn3-button');
    const fullTranscriptButton = document.getElementById('full-transcript-button');
    const transcriptTextarea = document.getElementById('transcript');

    // Audio recording variables
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let recordingInterval;
    let recordingStartTime;

    // Audio recording functions with WAV compatibility
    function startRecording() {
        // Request microphone access with optimized settings
        navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,      // Standard for speech recognition
                channelCount: 1,        // Mono audio
                echoCancellation: true,
                noiseSuppression: true
            }
        })
            .then(stream => {
                audioChunks = [];

                // Try to use WAV format first (most compatible)
                let mimeType = 'audio/wav';

                // Check for supported MIME types in order of preference
                const supportedTypes = [
                    'audio/wav',
                    'audio/webm;codecs=pcm',
                    'audio/webm;codecs=opus',
                    'audio/mp4',
                    'audio/webm'
                ];

                for (const type of supportedTypes) {
                    if (MediaRecorder.isTypeSupported(type)) {
                        mimeType = type;
                        break;
                    }
                }

                console.log('Using MIME type:', mimeType);

                // Create media recorder with the best supported format
                mediaRecorder = new MediaRecorder(stream, {
                    mimeType: mimeType,
                    audioBitsPerSecond: 128000  // Good quality for speech
                });

                // Handle data available event
                mediaRecorder.addEventListener('dataavailable', event => {
                    if (event.data.size > 0) {
                        audioChunks.push(event.data);
                    }
                });

                // Handle recording stop event
                mediaRecorder.addEventListener('stop', async () => {
                    // Convert audio chunks to blob
                    const audioBlob = new Blob(audioChunks, { type: mimeType });

                    // Show processing message
                    recordingStatus.textContent = "Processing audio...";

                    try {
                        // ALWAYS convert to WAV for compatibility with Gemma3n
                        // Only skip conversion if it's already PCM WAV
                        let finalBlob = audioBlob;

                        if (mimeType !== 'audio/wav' && mimeType !== 'audio/webm;codecs=pcm') {
                            console.log('Converting from', mimeType, 'to WAV format');
                            finalBlob = await convertToWAV(audioBlob);
                            console.log('Conversion complete, final blob type:', finalBlob.type);
                            console.log('Final blob size:', finalBlob.size, 'bytes');
                        } else if (mimeType === 'audio/webm;codecs=pcm') {
                            // Even PCM WebM needs conversion to proper WAV format
                            console.log('Converting PCM WebM to WAV format');
                            finalBlob = await convertToWAV(audioBlob);
                        } else {
                            console.log('Already in WAV format, no conversion needed');
                        }

                        // Send audio blob to server
                        sendAudioToServer(finalBlob);
                    } catch (error) {
                        console.error('Error processing audio:', error);
                        recordingStatus.textContent = "Error processing audio";
                        setTimeout(() => {
                            recordingStatus.style.display = 'none';
                        }, 3000);
                    }

                    // Stop all tracks in the stream to release the microphone
                    stream.getTracks().forEach(track => track.stop());
                });

                // Start recording
                mediaRecorder.start(1000); // Collect data every second
                isRecording = true;

                // Update UI
                micButton.classList.add('recording');
                recordingStatus.style.display = 'block';
                recordingStartTime = Date.now();

                // Start timer
                recordingInterval = setInterval(updateRecordingTime, 1000);
            })
            .catch(error => {
                console.error('Error accessing microphone:', error);
                alert('Could not access microphone. Please check your browser permissions.');
            });
    }

    // Function to convert audio to WAV format for maximum compatibility
    async function convertToWAV(audioBlob) {
        return new Promise((resolve, reject) => {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000  // Standard rate for speech recognition
            });

            const fileReader = new FileReader();

            fileReader.onload = async function(e) {
                try {
                    // Decode the audio data
                    const arrayBuffer = e.target.result;
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                    // Convert to WAV
                    const wavBlob = audioBufferToWav(audioBuffer);

                    // Close the audio context to free resources
                    audioContext.close();

                    resolve(wavBlob);
                } catch (decodeError) {
                    console.error('Audio decode error:', decodeError);
                    audioContext.close();
                    reject(new Error('Failed to decode audio: ' + decodeError.message));
                }
            };

            fileReader.onerror = () => {
                audioContext.close();
                reject(new Error('Failed to read audio file'));
            };

            fileReader.readAsArrayBuffer(audioBlob);
        });
    }

    // Convert AudioBuffer to WAV blob
    function audioBufferToWav(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        const length = audioBuffer.length;
        const arrayBuffer = new ArrayBuffer(44 + length * numChannels * 2);
        const view = new DataView(arrayBuffer);

        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        const writeInt16 = (offset, value) => {
            view.setInt16(offset, value, true);
        };

        const writeInt32 = (offset, value) => {
            view.setInt32(offset, value, true);
        };

        // RIFF header
        writeString(0, 'RIFF');
        writeInt32(4, 36 + length * numChannels * 2);
        writeString(8, 'WAVE');

        // Format chunk
        writeString(12, 'fmt ');
        writeInt32(16, 16);
        writeInt16(20, format);
        writeInt16(22, numChannels);
        writeInt32(24, sampleRate);
        writeInt32(28, sampleRate * numChannels * bitDepth / 8);
        writeInt16(32, numChannels * bitDepth / 8);
        writeInt16(34, bitDepth);

        // Data chunk
        writeString(36, 'data');
        writeInt32(40, length * numChannels * 2);

        // Convert float samples to 16-bit PCM
        const channels = [];
        for (let i = 0; i < numChannels; i++) {
            channels.push(audioBuffer.getChannelData(i));
        }

        let offset = 44;
        for (let i = 0; i < length; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, channels[channel][i]));
                view.setInt16(offset, sample * 0x7FFF, true);
                offset += 2;
            }
        }

        // Create blob with explicit WAV MIME type
        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;

            // Update UI
            micButton.classList.remove('recording');

            // Stop timer
            clearInterval(recordingInterval);
        }
    }

    function updateRecordingTime() {
        const elapsedTime = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = elapsedTime % 60;
        recordingTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    function sendAudioToServer(audioBlob) {
        // Verify we have a proper WAV blob
        if (audioBlob.type !== 'audio/wav') {
            console.error('Error: Audio blob is not in WAV format:', audioBlob.type);
            recordingStatus.textContent = 'Error: Audio format conversion failed';
            setTimeout(() => {
                recordingStatus.style.display = 'none';
            }, 3000);
            return;
        }

        // Create FormData to send binary data
        const formData = new FormData();
        const filename = 'recording.wav';

        formData.append('audio_file', audioBlob, filename);

        console.log('Sending audio to server:');
        console.log('- Format:', audioBlob.type);
        console.log('- Size:', audioBlob.size, 'bytes');
        console.log('- Filename:', filename);

        fetch('/process_audio', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // Update transcript textarea with the transcribed text
                transcriptTextarea.value = data.transcript;

                // Hide recording status
                recordingStatus.style.display = 'none';
            } else {
                console.error('Error processing audio:', data.error);
                recordingStatus.textContent = 'Error processing audio. Please try again.';
                setTimeout(() => {
                    recordingStatus.style.display = 'none';
                }, 3000);
            }
        })
        .catch(error => {
            console.error('Error sending audio to server:', error);
            recordingStatus.textContent = 'Error sending audio to server. Please try again.';
            setTimeout(() => {
                recordingStatus.style.display = 'none';
            }, 3000);
        });
    }

    // Add event listener to mic button
    if (micButton) {
        micButton.addEventListener('click', function() {
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        });
    }

    if (transcriptForm) {
        // Add direct click handler for the button
        if (processButton) {
            processButton.addEventListener('click', function() {
                // Trigger the form's submit event which will be handled by our AJAX handler
                // Use a custom event to ensure our event handler is called
                const submitEvent = new Event('submit', {
                    'bubbles': true,
                    'cancelable': true
                });
                transcriptForm.dispatchEvent(submitEvent);
            });
        }

        transcriptForm.addEventListener('submit', function(e) {
            e.preventDefault();

            console.log("Form submission triggered");

            // Disable the button to prevent multiple submissions
            if (processButton) {
                processButton.disabled = true;
            }

            // Show processing indicator
            if (processingIndicator) {
                processingIndicator.style.display = 'block';
            }

            // Show processing message with updates
            if (aiResponseContainer) {
                let processingMessages = [
                    "Processing transcript...",
                    "Analyzing the conversation...",
                    "Extracting key information...",
                    "Generating response...",
                    "Almost done..."
                ];

                let messageIndex = 0;
                aiResponseContainer.innerHTML = '<div class="info-box">' + processingMessages[0] + '</div>';

                // Update the message every 3 seconds
                const messageInterval = setInterval(() => {
                    messageIndex = (messageIndex + 1) % processingMessages.length;
                    aiResponseContainer.innerHTML = '<div class="info-box">' + processingMessages[messageIndex] + '</div>';
                }, 3000);

                // Store the interval ID to clear it later
                window.processingMessageInterval = messageInterval;
            }

            // Get form data
            const formData = new FormData(transcriptForm);

            // Send AJAX request
            fetch('/process_transcript', {
                method: 'POST',
                body: formData
            })
            .then(response => {
                console.log("Response received:", response);
                if (!response.ok) {
                    throw new Error(`Server responded with status: ${response.status}`);
                }
                return response.json().catch(err => {
                    throw new Error("Failed to parse response as JSON: " + err.message);
                });
            })
            .then(data => {
                console.log("Data received:", data);

                // Hide processing indicator
                if (processingIndicator) {
                    processingIndicator.style.display = 'none';
                }

                // Clear the processing message interval
                if (window.processingMessageInterval) {
                    clearInterval(window.processingMessageInterval);
                    window.processingMessageInterval = null;
                }

                // Update AI response
                if (aiResponseContainer) {
                    // Check if data.response exists, use a fallback message if it doesn't
                    if (data && data.response) {
                        aiResponseContainer.innerHTML = data.response;
                    } else {
                        console.error("Response data is missing or invalid:", data);
                        aiResponseContainer.innerHTML = '<div class="info-box">Response received but no content was returned. Please try again.</div>';
                    }
                }

                // Re-enable the button
                if (processButton) {
                    processButton.disabled = false;
                }

                // Make sure the interval is cleared
                if (window.processingMessageInterval) {
                    clearInterval(window.processingMessageInterval);
                    window.processingMessageInterval = null;
                }

                // No page refresh needed - the UI is already updated with the response data
                console.log("Processing complete, UI updated with response data");

                // Update demo state if available
                if (data.demo_state && window.updateButtonStates) {
                    console.log("Received demo_state from server:", data.demo_state);

                    // Log the button states before update
                    console.log("Button states before update - Turn 1:", turn1Button.disabled ? "disabled" : "enabled",
                                "Turn 2:", turn2Button.disabled ? "disabled" : "enabled",
                                "Turn 3:", turn3Button.disabled ? "disabled" : "enabled");

                    // Update the demo state with the data from the API response
                    window.demoState = data.demo_state;

                    // Update the button states based on the new demo state
                    window.updateButtonStates();

                    // Log the button states after update
                    console.log("Button states after update - Turn 1:", turn1Button.disabled ? "disabled" : "enabled",
                                "Turn 2:", turn2Button.disabled ? "disabled" : "enabled",
                                "Turn 3:", turn3Button.disabled ? "disabled" : "enabled");

                    console.log("Demo state updated:", window.demoState);
                } else {
                    console.warn("Could not update demo state:",
                        data.demo_state ? "updateButtonStates not found" : "demo_state not in response",
                        "data:", data);
                }

                // Update the transcript history section
                const historyColumn = document.querySelector('.column:nth-child(3)');
                if (historyColumn && data.success && data.response) {
                    // Get the transcript text
                    const transcriptText = document.getElementById('transcript').value;

                    // Check if we need to add the clear history button
                    let clearHistoryButton = historyColumn.querySelector('#clear-history-button');
                    if (!clearHistoryButton) {
                        // Remove the "No conversation history" message if it exists
                        const infoBox = historyColumn.querySelector('.info-box');
                        if (infoBox) {
                            historyColumn.removeChild(infoBox);
                        }

                        // Add the clear history button
                        clearHistoryButton = document.createElement('button');
                        clearHistoryButton.id = 'clear-history-button';
                        clearHistoryButton.textContent = 'Clear History';
                        historyColumn.appendChild(clearHistoryButton);

                        // Add event listener to the new button
                        clearHistoryButton.addEventListener('click', function() {
                            fetch('/clear_history', {
                                method: 'POST'
                            })
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error(`Server responded with status: ${response.status}`);
                                }
                                return response.json().catch(err => {
                                    throw new Error("Failed to parse response as JSON: " + err.message);
                                });
                            })
                            .then(data => {
                                if (data.success) {
                                    // No page refresh needed, just update the UI
                                    // Remove the conversation history elements from the DOM
                                    const historyContainer = clearHistoryButton.parentElement;
                                    while (historyContainer.firstChild) {
                                        historyContainer.removeChild(historyContainer.firstChild);
                                    }

                                    // Add a message indicating history was cleared
                                    const infoBox = document.createElement('div');
                                    infoBox.className = 'info-box';
                                    infoBox.textContent = 'No conversation history yet. Submit a transcript to see the history here.';
                                    historyContainer.appendChild(infoBox);

                                    console.log("History cleared successfully");
                                }
                            })
                            .catch(error => {
                                console.error('Error:', error);
                            });
                        });
                    }

                    // Get the number of existing conversations
                    const existingConversations = historyColumn.querySelectorAll('.conversation');
                    const conversationNumber = existingConversations.length + 1;

                    // Create the new conversation element
                    const conversationDiv = document.createElement('div');
                    conversationDiv.className = 'conversation';

                    // Create the conversation header
                    const headerDiv = document.createElement('div');
                    headerDiv.className = 'conversation-header';
                    headerDiv.textContent = `Conversation ${conversationNumber}`;

                    // Create the conversation body
                    const bodyDiv = document.createElement('div');
                    bodyDiv.className = 'conversation-body';
                    bodyDiv.style.display = 'block'; // Show the first conversation by default

                    // Create the transcript section
                    const transcriptSection = document.createElement('div');
                    transcriptSection.className = 'conversation-section';

                    const transcriptHeader = document.createElement('h3');
                    transcriptHeader.textContent = 'User Transcript';

                    const transcriptArea = document.createElement('textarea');
                    transcriptArea.disabled = true;
                    transcriptArea.textContent = transcriptText;

                    transcriptSection.appendChild(transcriptHeader);
                    transcriptSection.appendChild(transcriptArea);

                    // Create the AI response section
                    const responseSection = document.createElement('div');
                    responseSection.className = 'conversation-section';

                    const responseHeader = document.createElement('h3');
                    responseHeader.textContent = 'AI Response';

                    const responseDiv = document.createElement('div');
                    responseDiv.innerHTML = data.response;

                    responseSection.appendChild(responseHeader);
                    responseSection.appendChild(responseDiv);

                    // Add sections to the body
                    bodyDiv.appendChild(transcriptSection);
                    bodyDiv.appendChild(responseSection);

                    // The queried_table is not included in the response from the server
                    // We'll skip this section as it's not available in the AJAX response

                    // Add header and body to the conversation div
                    conversationDiv.appendChild(headerDiv);
                    conversationDiv.appendChild(bodyDiv);

                    // Add the conversation to the history column (after the clear button)
                    if (clearHistoryButton) {
                        historyColumn.insertBefore(conversationDiv, clearHistoryButton.nextSibling);
                    } else {
                        historyColumn.appendChild(conversationDiv);
                    }

                    // Add click handler for the new conversation header
                    headerDiv.addEventListener('click', function() {
                        if (bodyDiv.style.display === 'none' || bodyDiv.style.display === '') {
                            bodyDiv.style.display = 'block';
                            this.classList.add('active');
                        } else {
                            bodyDiv.style.display = 'none';
                            this.classList.remove('active');
                        }
                    });

                    // Collapse other conversations
                    existingConversations.forEach(conv => {
                        const body = conv.querySelector('.conversation-body');
                        const header = conv.querySelector('.conversation-header');
                        if (body) {
                            body.style.display = 'none';
                        }
                        if (header) {
                            header.classList.remove('active');
                        }
                    });
                }
            })
            .catch(error => {
                console.error('Error:', error);

                // Hide processing indicator
                if (processingIndicator) {
                    processingIndicator.style.display = 'none';
                }

                // Clear the processing message interval
                if (window.processingMessageInterval) {
                    clearInterval(window.processingMessageInterval);
                    window.processingMessageInterval = null;
                }

                // Re-enable the button
                if (processButton) {
                    processButton.disabled = false;
                }

                // Show error message
                if (aiResponseContainer) {
                    let errorMessage = 'An error occurred during processing. Please try again.';

                    // Display the error message immediately
                    aiResponseContainer.innerHTML = '<div class="error-box">' + errorMessage + '</div>';

                    // Log the error details to the console for debugging
                    console.error('Error details:', error);
                }
            });
        });
    }

    // Conversation expansion/collapse
    const conversationHeaders = document.querySelectorAll('.conversation-header');

    conversationHeaders.forEach(header => {
        header.addEventListener('click', function() {
            const body = this.nextElementSibling;
            if (body.style.display === 'none' || body.style.display === '') {
                body.style.display = 'block';
                this.classList.add('active');
            } else {
                body.style.display = 'none';
                this.classList.remove('active');
            }
        });
    });

    // Expand the first conversation by default
    if (conversationHeaders.length > 0) {
        const firstBody = conversationHeaders[0].nextElementSibling;
        if (firstBody) {
            firstBody.style.display = 'block';
            conversationHeaders[0].classList.add('active');
        }
    }

    // Clear history button
    const clearHistoryButton = document.getElementById('clear-history-button');

    if (clearHistoryButton) {
        clearHistoryButton.addEventListener('click', function() {
            fetch('/clear_history', {
                method: 'POST'
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Server responded with status: ${response.status}`);
                }
                return response.json().catch(err => {
                    throw new Error("Failed to parse response as JSON: " + err.message);
                });
            })
            .then(data => {
                if (data.success) {
                    // No page refresh needed, just update the UI
                    // Remove the conversation history elements from the DOM
                    const historyContainer = clearHistoryButton.parentElement;
                    while (historyContainer.firstChild) {
                        historyContainer.removeChild(historyContainer.firstChild);
                    }

                    // Add a message indicating history was cleared
                    const infoBox = document.createElement('div');
                    infoBox.className = 'info-box';
                    infoBox.textContent = 'No conversation history yet. Submit a transcript to see the history here.';
                    historyContainer.appendChild(infoBox);

                    console.log("History cleared successfully");
                }
            })
            .catch(error => {
                console.error('Error:', error);
            });
        });
    }

    // Demo mode functionality
    if (demoModeButton && demoButtonsContainer && turn1Button && turn2Button && turn3Button && fullTranscriptButton && transcriptTextarea) {
        // Parse demo state from data attribute
        // Make demoState accessible to other functions
        window.demoState;
        try {
            window.demoState = JSON.parse(demoButtonsContainer.getAttribute('data-demo-state') || '{}');
        } catch (e) {
            window.demoState = {
                current_turn: 1,
                turn1_processed: false,
                turn2_processed: false,
                turn3_processed: false
            };
        }

        // Example transcripts - these should match the ones in app.py
        const exampleTranscripts = {
            turn1: `Austin: Thank you for calling QuickShip Logistics, this is Austin speaking. How may I assist you today?
Avery Johnson: Hi Austin, this is Avery Johnson. I need to schedule a pickup for multiple packages at different locations, but your online system keeps giving me errors.
Austin: I apologize for the inconvenience, Mr. Johnson. I'd be happy to help you with those multiple pickups. Could you please provide your account number so I can pull up your information?
Avery Johnson: Yes, it's AJ78542. Look, I've been trying to arrange this for two days now. I have three different pickup locations, all with different freight classes, and your system just can't seem to handle it.`,

            turn2: `Austin: I see your account here, Mr. Johnson. You're right - our system has limitations with multi-point pickups when different freight classifications are involved. For your Class 70 machinery parts and Class 125 electronics, we'll need to create separate BOLs to ensure proper handling through our sortation hubs.
Avery Johnson: That's ridiculous! I've used other carriers that can handle this easily. And now I'm concerned about transit times - my customers need these deliveries by Friday, and your last mile optimization has been terrible lately.
Austin: I understand your frustration. What I can do is manually create a consolidated pickup request and apply our expedited service to ensure delivery before Friday. There will be an additional handling fee of $45 per location, but I can waive the route optimization surcharge given the circumstances.
Avery Johnson: Fine, but I'm not happy about these extra fees. Will this at least guarantee that all packages move through the same regional hub? Last time my shipments were split between facilities and arrived three days apart.`,

            turn3: `Austin: Yes, I'll add special instructions to keep all packages within our Eastern consolidation network. I'll also assign a dedicated dispatcher to monitor these shipments and provide you with tracking updates at each checkpoint. Would you like me to proceed with scheduling these pickups for tomorrow morning?
Avery Johnson: Yes, schedule them for tomorrow morning, but I need specific time windows. The Chicago location can only do 8-10 AM, the Detroit warehouse needs afternoon pickup, and my Cleveland facility closes at 3 PM sharp.
Austin: I've noted those time constraints, Mr. Johnson. I can confirm Chicago for 8-10 AM, Cleveland for 12-2 PM, and Detroit for 3-5 PM. Our drivers will call 30 minutes before arrival. Are there any special handling instructions I should be aware of? Any of these shipments contain hazmat materials?
Avery Johnson: The Detroit shipment has lithium batteries, Class 9 hazmat. And I need temperature-controlled transport for the Cleveland pharmaceuticals - they can't exceed 77 degrees Fahrenheit. Your driver missed that requirement last time.
Austin: Thank you for that information. I've added the Class 9 hazmat designation for the Detroit pickup and specified temperature control requirements for the Cleveland pharmaceuticals. I'll also flag this in our TMS for special handling and assign a reefer unit for the Cleveland pickup. Would you like me to email you the pre-printed labels and BOLs for each location?
Avery Johnson: Yes, email those right away. And listen, I need better communication this time. If there are any delays at the cross-dock or issues with customs clearance for the international pieces, someone better call me immediately, not after the delivery window is missed.
Austin: Absolutely, Mr. Johnson. I'm setting up automated alerts to your email and phone for each milestone scan. I'll personally monitor these shipments through our hub transfer and assign them priority status during sortation. I've also noted your account for a follow-up call tomorrow afternoon to confirm all pickups were completed successfully. Is there anything else I can assist you with today?`,

            full: `Austin: Thank you for calling QuickShip Logistics, this is Austin speaking. How may I assist you today?
Avery Johnson: Hi Austin, this is Avery Johnson. I need to schedule a pickup for multiple packages at different locations, but your online system keeps giving me errors.
Austin: I apologize for the inconvenience, Mr. Johnson. I'd be happy to help you with those multiple pickups. Could you please provide your account number so I can pull up your information?
Avery Johnson: Yes, it's AJ78542. Look, I've been trying to arrange this for two days now. I have three different pickup locations, all with different freight classes, and your system just can't seem to handle it.
Austin: I see your account here, Mr. Johnson. You're right - our system has limitations with multi-point pickups when different freight classifications are involved. For your Class 70 machinery parts and Class 125 electronics, we'll need to create separate BOLs to ensure proper handling through our sortation hubs.
Avery Johnson: That's ridiculous! I've used other carriers that can handle this easily. And now I'm concerned about transit times - my customers need these deliveries by Friday, and your last mile optimization has been terrible lately.
Austin: I understand your frustration. What I can do is manually create a consolidated pickup request and apply our expedited service to ensure delivery before Friday. There will be an additional handling fee of $45 per location, but I can waive the route optimization surcharge given the circumstances.
Avery Johnson: Fine, but I'm not happy about these extra fees. Will this at least guarantee that all packages move through the same regional hub? Last time my shipments were split between facilities and arrived three days apart.
Austin: Yes, I'll add special instructions to keep all packages within our Eastern consolidation network. I'll also assign a dedicated dispatcher to monitor these shipments and provide you with tracking updates at each checkpoint. Would you like me to proceed with scheduling these pickups for tomorrow morning?
Avery Johnson: Yes, schedule them for tomorrow morning, but I need specific time windows. The Chicago location can only do 8-10 AM, the Detroit warehouse needs afternoon pickup, and my Cleveland facility closes at 3 PM sharp.
Austin: I've noted those time constraints, Mr. Johnson. I can confirm Chicago for 8-10 AM, Cleveland for 12-2 PM, and Detroit for 3-5 PM. Our drivers will call 30 minutes before arrival. Are there any special handling instructions I should be aware of? Any of these shipments contain hazmat materials?
Avery Johnson: The Detroit shipment has lithium batteries, Class 9 hazmat. And I need temperature-controlled transport for the Cleveland pharmaceuticals - they can't exceed 77 degrees Fahrenheit. Your driver missed that requirement last time.
Austin: Thank you for that information. I've added the Class 9 hazmat designation for the Detroit pickup and specified temperature control requirements for the Cleveland pharmaceuticals. I'll also flag this in our TMS for special handling and assign a reefer unit for the Cleveland pickup. Would you like me to email you the pre-printed labels and BOLs for each location?
Avery Johnson: Yes, email those right away. And listen, I need better communication this time. If there are any delays at the cross-dock or issues with customs clearance for the international pieces, someone better call me immediately, not after the delivery window is missed.
Austin: Absolutely, Mr. Johnson. I'm setting up automated alerts to your email and phone for each milestone scan. I'll personally monitor these shipments through our hub transfer and assign them priority status during sortation. I've also noted your account for a follow-up call tomorrow afternoon to confirm all pickups were completed successfully. Is there anything else I can assist you with today?`
        };

        // Function to update button states based on demo state
        // Make updateButtonStates accessible to other functions
        window.updateButtonStates = function() {
            console.log("Updating button states with demo state:", window.demoState);

            // Check if we need to show the demo buttons container
            if (window.demoState.current_turn > 1 || window.demoState.turn1_processed || window.demoState.turn2_processed || window.demoState.turn3_processed) {
                demoModeButton.style.display = 'none';
                demoButtonsContainer.style.display = 'block';
            }

            // First, determine the current turn based on the processed state
            if (window.demoState.turn1_processed && !window.demoState.turn2_processed) {
                // If Turn 1 is processed but Turn 2 is not, we should be on Turn 2
                window.demoState.current_turn = 2;
            } else if (window.demoState.turn2_processed && !window.demoState.turn3_processed) {
                // If Turn 2 is processed but Turn 3 is not, we should be on Turn 3
                window.demoState.current_turn = 3;
            }

            // Update each button's disabled state based on whether its turn has been processed
            turn1Button.disabled = window.demoState.turn1_processed;
            turn2Button.disabled = window.demoState.turn2_processed;
            turn3Button.disabled = window.demoState.turn3_processed;

            console.log("Button states updated - Turn 1:", turn1Button.disabled ? "disabled" : "enabled",
                        "Turn 2:", turn2Button.disabled ? "disabled" : "enabled",
                        "Turn 3:", turn3Button.disabled ? "disabled" : "enabled");
        }

        // Initialize button states
        window.updateButtonStates();

        // Demo Mode button click handler
        demoModeButton.addEventListener('click', function() {
            // Hide the demo mode button
            demoModeButton.style.display = 'none';

            // Show the demo buttons container
            demoButtonsContainer.style.display = 'block';

            // Reset to Turn 1
            window.demoState.current_turn = 1;
            window.demoState.turn1_processed = false;
            window.demoState.turn2_processed = false;
            window.demoState.turn3_processed = false;

            // Update button states
            window.updateButtonStates();
        });

        // Turn 1 button click handler
        turn1Button.addEventListener('click', function() {
            console.log("Turn 1 button clicked");

            // Load the Turn 1 transcript
            transcriptTextarea.value = exampleTranscripts.turn1;

            // Gray out the button after clicking
            turn1Button.disabled = true;

            console.log("Turn 1 transcript loaded. Button disabled:", turn1Button.disabled);
        });

        // Turn 2 button click handler
        turn2Button.addEventListener('click', function() {
            console.log("Turn 2 button clicked");

            // Load the Turn 2 transcript
            transcriptTextarea.value = exampleTranscripts.turn2;

            // Gray out the button after clicking
            turn2Button.disabled = true;

            console.log("Turn 2 transcript loaded. Button disabled:", turn2Button.disabled);
        });

        // Turn 3 button click handler
        turn3Button.addEventListener('click', function() {
            console.log("Turn 3 button clicked");

            // Load the Turn 3 transcript
            transcriptTextarea.value = exampleTranscripts.turn3;

            // Gray out the button after clicking
            turn3Button.disabled = true;

            console.log("Turn 3 transcript loaded. Button disabled:", turn3Button.disabled);
        });

        // Full Transcript button click handler
        fullTranscriptButton.addEventListener('click', function() {
            transcriptTextarea.value = exampleTranscripts.full;
        });

        // Process button click handler - additional functionality
        processButton.addEventListener('click', function() {
            // The form submission will happen through the existing handler
            // The demo state will be updated when the API response is received
        });

        // We'll update the button states when the response is received
        // This is now handled by the updateButtonStates function in the API response handler
    }
});