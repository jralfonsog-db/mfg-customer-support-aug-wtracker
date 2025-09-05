import mlflow
import mlflow.deployments
import pandas as pd
import time

client = mlflow.deployments.get_deploy_client("databricks")
endpoint_name = "gemma3n_image_audio_text"
# endpoint_name = "gemma3nText_Image_Audio"
databricks_instance = dbutils.entry_point.getDbutils().notebook().getContext().browserHostName().get()
endpoint_url = f"https://{databricks_instance}/ml/endpoints/{endpoint_name}"
print(f"Endpoint URL: {endpoint_url}")

start_time = time.time()
response = client.predict(
            endpoint=endpoint_name,
            inputs={"dataframe_split": {
                    "columns": ["text","audio_base64", "image_base64"],
                    "data": [[text, audio_base64, image_base64]]
                    }
            }
          )
end_time = time.time()
total_time = end_time-start_time
print(response)
print(f"Final Time: {total_time}")
