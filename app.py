import dspy
import mlflow
import mlflow.deployments
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from typing import Optional
from pyspark.sql import SparkSession
from databricks.connect import DatabricksSession
import os
from markupsafe import Markup
import markdown2
import time
import base64

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.urandom(24)  # For session management

# Define the transcript router class
class transcript_router(dspy.Signature):
    """This handles a ongoing, live call transcript and determines what tools to call to find relevant information to help the call agent handle the conversation with the customer. Prioritize the call_agent_ask to find more useful information to the call agent and to determine which tables to use in the sql query. Check conversatinon_history to see what tables were already sql queried and use that if so. Do not re-query. Skip to a FINISH action if no tools are required given the information. Prepare relevant_information to help the call agent solve issues, achieve upsell goals and prioritize calls
    relevant_information must be in formatted like a report in Markdown and is also your response"""
    transcript: str = dspy.InputField()
    call_agent_ask: Optional[str] = dspy.InputField()
    conversation_history: list = dspy.InputField()
    queried_table: str = dspy.OutputField()
    relevant_information: str = dspy.OutputField(desc="Format using Markdown. Use actual newlines, not \ n characters. If necessary, add a recommended response to say for the call_agent")


def sql_lookup(sql_query):
    """This function is to query the following tables to find more information based on the provided transcript. Decide which table to use based on the call_agent's ask and transcript situation.

    Available Tables are:

    1. austin_choi_demo_catalog.agents.transcripts which has agent_name, customer_name, tone, topic, transcript
    2. austin_choi_demo_catalog.agents.customer_profiles which has customer_name, total_calls, complaint_calls, avg_sentiment_score, avg_category_confidence, estimated_support_cost, product_calls, technical_calls, qualiity_calls, other_calls, customer_lifetime_value, profit_margin, profitability_class, recommended_action

    Use austin_choi_demo_catalog.agents.transcripts to find past call conversations to see how other agents handled a situation when requested by the agent

    Use austin_choi_demo_catalog.agents.customer_profiles to find customer information.
    """
    try:
        spark = DatabricksSession.builder.serverless(True).getOrCreate()
        print("Spark Session successfully retrieved.")
        results = spark.sql(sql_query)
        data_list = [row.asDict() for row in results.collect()]
        return data_list
    except NameError:
        # For local development where spark might not be available
        print("Spark not available in this environment. Using mock data.")
        return [{"mock_data": "This is mock data since Spark is not available"}]


# Configure MLflow
mlflow.set_tracking_uri("databricks")
mlflow.set_registry_uri("databricks-uc")

# DSPy LLM configuration will be set dynamically based on form input
selected_llm = dspy.LM(f"databricks/databricks-claude-3-7-sonnet", cache=False)
dspy.configure(lm=selected_llm)

# Enable MLflow DSPy autologging at startup
mlflow.dspy.autolog()

example_transcript_turn_1 = """
Austin: Thank you for calling QuickShip Logistics, this is Austin speaking. How may I assist you today?
Avery Johnson: Hi Austin, this is Avery Johnson. I need to schedule a pickup for multiple packages at different locations, but your online system keeps giving me errors.
Austin: I apologize for the inconvenience, Mr. Johnson. I'd be happy to help you with those multiple pickups. Could you please provide your account number so I can pull up your information?
Avery Johnson: Yes, it's AJ78542. Look, I've been trying to arrange this for two days now. I have three different pickup locations, all with different freight classes, and your system just can't seem to handle it.
"""

example_transcript_turn_2 = """
Austin: I see your account here, Mr. Johnson. You're right - our system has limitations with multi-point pickups when different freight classifications are involved. For your Class 70 machinery parts and Class 125 electronics, we'll need to create separate BOLs to ensure proper handling through our sortation hubs.
Avery Johnson: That's ridiculous! I've used other carriers that can handle this easily. And now I'm concerned about transit times - my customers need these deliveries by Friday, and your last mile optimization has been terrible lately.
Austin: I understand your frustration. What I can do is manually create a consolidated pickup request and apply our expedited service to ensure delivery before Friday. There will be an additional handling fee of $45 per location, but I can waive the route optimization surcharge given the circumstances.
Avery Johnson: Fine, but I'm not happy about these extra fees. Will this at least guarantee that all packages move through the same regional hub? Last time my shipments were split between facilities and arrived three days apart.
"""

example_transcript_turn_3 = """
Austin: Yes, I'll add special instructions to keep all packages within our Eastern consolidation network. I'll also assign a dedicated dispatcher to monitor these shipments and provide you with tracking updates at each checkpoint. Would you like me to proceed with scheduling these pickups for tomorrow morning?
Avery Johnson: Yes, schedule them for tomorrow morning, but I need specific time windows. The Chicago location can only do 8-10 AM, the Detroit warehouse needs afternoon pickup, and my Cleveland facility closes at 3 PM sharp.
Austin: I've noted those time constraints, Mr. Johnson. I can confirm Chicago for 8-10 AM, Cleveland for 12-2 PM, and Detroit for 3-5 PM. Our drivers will call 30 minutes before arrival. Are there any special handling instructions I should be aware of? Any of these shipments contain hazmat materials?
Avery Johnson: The Detroit shipment has lithium batteries, Class 9 hazmat. And I need temperature-controlled transport for the Cleveland pharmaceuticals - they can't exceed 77 degrees Fahrenheit. Your driver missed that requirement last time.
Austin: Thank you for that information. I've added the Class 9 hazmat designation for the Detroit pickup and specified temperature control requirements for the Cleveland pharmaceuticals. I'll also flag this in our TMS for special handling and assign a reefer unit for the Cleveland pickup. Would you like me to email you the pre-printed labels and BOLs for each location?
Avery Johnson: Yes, email those right away. And listen, I need better communication this time. If there are any delays at the cross-dock or issues with customs clearance for the international pieces, someone better call me immediately, not after the delivery window is missed.
Austin: Absolutely, Mr. Johnson. I'm setting up automated alerts to your email and phone for each milestone scan. I'll personally monitor these shipments through our hub transfer and assign them priority status during sortation. I've also noted your account for a follow-up call tomorrow afternoon to confirm all pickups were completed successfully. Is there anything else I can assist you with today?
"""

example_transcript_full = """
Austin: Thank you for calling QuickShip Logistics, this is Austin speaking. How may I assist you today?
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
Austin: Absolutely, Mr. Johnson. I'm setting up automated alerts to your email and phone for each milestone scan. I'll personally monitor these shipments through our hub transfer and assign them priority status during sortation. I've also noted your account for a follow-up call tomorrow afternoon to confirm all pickups were completed successfully. Is there anything else I can assist you with today?
"""

# Initialize session defaults
def init_session(force_reset=False):
    # Check if this is a new browser session or if force_reset is True
    if 'browser_session_id' not in session or force_reset:
        # Clear all session data for new browser sessions or resets
        session.clear()
        # Set a browser session ID to track this session
        session['browser_session_id'] = os.urandom(16).hex()

        # Initialize session variables with default values
        session['ai_response'] = ""
        session['conversation_history'] = []
        session['transcript_input'] = "Put a transcript you would like to analyze here"
        session['mlflow_experiment_id'] = ""
        session['llm_model'] = "databricks-claude-3-7-sonnet"
        session['processing'] = False
        session['demo_state'] = {
            'current_turn': 1,
            'turn1_processed': False,
            'turn2_processed': False,
            'turn3_processed': False
        }
    else:
        # Initialize session variables if they don't exist
        if 'ai_response' not in session:
            session['ai_response'] = ""
        if 'conversation_history' not in session:
            session['conversation_history'] = []
        if 'transcript_input' not in session:
            session['transcript_input'] = "Put a transcript you would like to analyze here"
        if 'mlflow_experiment_id' not in session:
            session['mlflow_experiment_id'] = ""
        if 'llm_model' not in session:
            session['llm_model'] = "databricks-claude-3-7-sonnet"
        if 'processing' not in session:
            session['processing'] = False
        if 'demo_state' not in session:
            session['demo_state'] = {
                'current_turn': 1,
                'turn1_processed': False,
                'turn2_processed': False,
                'turn3_processed': False
            }

# Routes
@app.route('/')
def index():
    # Force reset session on direct page load or refresh
    # This ensures everything resets back to its original state on browser refresh
    init_session(force_reset=True)

    return render_template('index.html',
                          transcript_input=session.get('transcript_input', ''),
                          ai_response=Markup(session.get('ai_response', '')),
                          conversation_history=session.get('conversation_history', []),
                          processing=session.get('processing', False),
                          demo_state=session.get('demo_state', {}))

@app.route('/process_transcript', methods=['POST'])
def process_transcript():
    init_session()

    # Get form data
    transcript = request.form.get('transcript', '')
    call_agent_ask = request.form.get('call_agent_ask', '')
    mlflow_experiment_id = request.form.get('mlflow_experiment_id', '')
    llm_model = request.form.get('llm_model', 'databricks-claude-3-7-sonnet')

    # Print debug information
    print(f"Process transcript request received. Transcript length: {len(transcript)}")
    print(f"Call agent ask: {call_agent_ask}")
    print(f"MLflow experiment ID: {mlflow_experiment_id}")
    print(f"LLM model: {llm_model}")
    print(f"Form data: {request.form}")

    # Update session
    session['transcript_input'] = transcript
    session['mlflow_experiment_id'] = mlflow_experiment_id
    session['llm_model'] = llm_model
    session['processing'] = True

    # Configure MLflow experiment if ID is provided
    if mlflow_experiment_id:
        try:
            mlflow.set_experiment(experiment_id=mlflow_experiment_id)
            print(f"MLflow experiment set to ID: {mlflow_experiment_id}")
        except Exception as e:
            print(f"Error setting MLflow experiment ID: {str(e)}")
            return jsonify({
                'success': False,
                'error': f'Invalid MLflow experiment ID: {mlflow_experiment_id}',
                'user_message': f'Please check the MLflow experiment ID: {mlflow_experiment_id}',
                'demo_state': session.get('demo_state', {})
            }), 400

    # Configure DSPy with selected model
    try:
        selected_llm = dspy.LM(f"databricks/{llm_model}", cache=False)
        # dspy.configure(lm=selected_llm)
        print(f"DSPy configured with model: databricks/{llm_model}")
        
        # Re-initialize transcript_routing with the new model configuration
        transcript_routing = dspy.ReAct(transcript_router, tools=[sql_lookup], max_iters=3)
    except Exception as e:
        print(f"Error configuring DSPy with model {llm_model}: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Error configuring LLM model: {llm_model}',
            'user_message': f'Failed to configure the selected model: {llm_model}',
            'demo_state': session.get('demo_state', {})
        }), 500

    try:
        # Process the transcript
        mlflow_run = None
        try:
            # Start MLflow run with explicit error handling
            mlflow_run = mlflow.start_run()

            print("Starting transcript processing with MLflow run ID:", mlflow_run.info.run_id)

            # Call the transcript_routing function with the user's input
            with dspy.context(lm=selected_llm):
                response = transcript_routing(
                    transcript=transcript,
                    call_agent_ask=call_agent_ask if call_agent_ask else None,
                    conversation_history=session.get('conversation_history', [])
                )

            print("Transcript processing completed successfully")

            # Validate response data
            if not hasattr(response, 'relevant_information') or not response.relevant_information:
                print("Warning: Response is missing relevant_information")
                response.relevant_information = "No relevant information was found."

            if not hasattr(response, 'queried_table'):
                print("Warning: Response is missing queried_table")
                response.queried_table = ""

            # Convert Markdown to HTML with error handling
            try:
                # Debug: print the raw markdown content
                print("Raw markdown content:")
                print(response.relevant_information)
                print("=" * 50)
                
                # Use markdown2 with extras for better rendering
                markdown_response = markdown2.markdown(
                    response.relevant_information,
                    extras=['fenced-code-blocks', 'tables', 'break-on-newline']
                )
                
                # Debug: print the converted HTML
                print("Converted HTML:")
                print(markdown_response)
                print("=" * 50)
                
                print("Markdown conversion successful")
            except Exception as md_error:
                print(f"Error converting markdown: {str(md_error)}")
                # Fallback to plain text if markdown conversion fails
                markdown_response = f"<pre>{response.relevant_information}</pre>"

            # Store the response in the conversation history
            conversation_history = session.get('conversation_history', [])
            conversation_history.append({
                "transcript": transcript,
                "response": markdown_response,
                "queried_table": response.queried_table
            })
            session['conversation_history'] = conversation_history
            print("Conversation history updated")

            # Store the response in session
            session['ai_response'] = markdown_response

            # Update demo state if we're in demo mode
            demo_state = session.get('demo_state', {})
            print("Demo state before update:", demo_state)
            if demo_state:
                # Check which turn was processed based on the transcript content
                if transcript.strip() == example_transcript_turn_1.strip():
                    demo_state['turn1_processed'] = True
                    # If Turn 1 is processed, update current_turn to 2
                    if not demo_state.get('turn2_processed', False):
                        demo_state['current_turn'] = 2
                    print("Turn 1 processed, updated demo_state:", demo_state)
                elif transcript.strip() == example_transcript_turn_2.strip():
                    demo_state['turn2_processed'] = True
                    # If Turn 2 is processed, update current_turn to 3
                    if not demo_state.get('turn3_processed', False):
                        demo_state['current_turn'] = 3
                    print("Turn 2 processed, updated demo_state:", demo_state)
                elif transcript.strip() == example_transcript_turn_3.strip():
                    demo_state['turn3_processed'] = True
                    print("Turn 3 processed, updated demo_state:", demo_state)
                session['demo_state'] = demo_state
                print("Demo state after update:", demo_state)

            # Prepare the response
            result = {
                'success': True,
                'response': markdown_response,
                'demo_state': session.get('demo_state', {})
            }

        finally:
            # Always end the MLflow run if it was started
            if mlflow_run:
                print("Ending MLflow run")
                mlflow.end_run()

            # Reset processing state regardless of success or failure
            session['processing'] = False

        return jsonify(result)

    except Exception as e:
        # Handle errors with more detailed logging
        import traceback
        error_traceback = traceback.format_exc()
        error_message = f"An error occurred during processing: {str(e)}"

        print("ERROR in process_transcript:")
        print(error_message)
        print(error_traceback)

        # Make sure processing state is reset
        session['processing'] = False

        # Provide a user-friendly error message
        user_message = "Sorry, an error occurred while processing your transcript. Please try again."

        # For debugging in development, include the actual error
        if app.debug:
            user_message += f" Error details: {str(e)}"

        return jsonify({
            'success': False,
            'error': error_message,
            'user_message': user_message,
            'demo_state': session.get('demo_state', {})
        }), 500

@app.route('/process_audio', methods=['POST'])
def process_audio():
    try:
        # Get audio file from request
        if 'audio_file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No audio file provided'
            }), 400

        audio_file = request.files['audio_file']
        filename = audio_file.filename
        print(f"Received audio file: {filename}")

        # Strictly verify file format is WAV or MP3
        if not (filename.lower().endswith('.wav') or filename.lower().endswith('.mp3')):
            error_msg = f"Error: Received file with unsupported format: {filename}. Only WAV or MP3 formats are supported."
            print(error_msg)
            return jsonify({
                'success': False,
                'error': error_msg
            }), 400

        # Read the file as bytes
        audio_bytes = audio_file.read()

        # Log file size and format for debugging
        file_format = filename.split('.')[-1].upper()
        print(f"Processing {file_format} audio file, size: {len(audio_bytes)} bytes")

        # Convert bytes to base64
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        print(f"Audio successfully converted to base64 (format: {file_format})")
        print(f"Base64 string length: {len(audio_base64)} characters")
        # Print just the first 50 characters of the base64 string for verification
        print(f"Base64 preview: {audio_base64[:50]}...")

        # Initialize MLflow client
        client = mlflow.deployments.get_deploy_client("databricks")
        endpoint_name = "gemma3n"

        try:
            # Get Databricks instance name
            databricks_instance = "e2-demo-west.cloud.databricks.com"
            endpoint_url = f"https://{databricks_instance}/ml/endpoints/{endpoint_name}"
            print(f"Endpoint URL: {endpoint_url}")
        except:
            # For local development where dbutils might not be available
            print("dbutils not available in this environment.")

        # Process the audio using the MLflow endpoint
        start_time = time.time()

        # Prepare the request payload with the base64-encoded audio
        # Include format information in the request
        audio_format = filename.split('.')[-1].lower()
        transcribe_prompt = f"transcribe the {audio_format} audio"
        print(f"Using transcription prompt: '{transcribe_prompt}'")

        request_payload = {
            "dataframe_split": {
                "columns": ["text", "audio_base64", "image_base64"],
                "data": [[transcribe_prompt, audio_base64, ""]]
            }
        }

        # Log the request details (without the actual base64 data which would be too large)
        print(f"Sending request to MLflow endpoint: {endpoint_name}")
        print(f"Request payload structure: {list(request_payload['dataframe_split'].keys())}")
        print(f"Audio format being sent: {audio_format}")
        print(f"Request includes audio format in prompt: {transcribe_prompt}")
        print(f"Columns being sent: {request_payload['dataframe_split']['columns']}")

        # Send the request to the MLflow endpoint
        response = client.predict(
            endpoint=endpoint_name,
            inputs=request_payload
        )

        end_time = time.time()
        total_time = end_time - start_time

        print(f"Response received from MLflow endpoint")
        print(f"Processing time: {total_time:.2f} seconds")

        # Extract the transcript from the response
        transcript = response['predictions']['predictions']

        return jsonify({
            'success': True,
            'transcript': transcript
        })

    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        error_message = f"An error occurred during audio processing: {str(e)}"

        print("ERROR in process_audio:")
        print(error_message)
        print(error_traceback)

        return jsonify({
            'success': False,
            'error': error_message
        }), 500

@app.route('/clear_history', methods=['POST'])
def clear_history():
    if 'conversation_history' in session:
        session['conversation_history'] = []
    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
