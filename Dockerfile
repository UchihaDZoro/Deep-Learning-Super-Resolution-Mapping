FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 RESULTS_DIR=/tmp/trinetra_results
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

COPY requirements.txt .
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt

COPY --chown=user prototype/run_sr.py prototype/
COPY --chown=user server/ server/
COPY --chown=user docs/ docs/

RUN mkdir -p prototype/model && chown -R user /home/user/app
USER user
# bake the model weights into the image so cold starts don't download them
RUN python -c "import sys; sys.path.insert(0, 'prototype'); import run_sr, torch; run_sr.load_model(torch.device('cpu'))"

EXPOSE 7860
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "7860"]
