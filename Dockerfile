FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/srv/budget \
    HOME=/tmp \
    BUDGET_DATA=/data

WORKDIR /srv/budget

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY .streamlit .streamlit
COPY app app

# Utilisateur sans privilèges ; /data est le seul dossier où l'app écrit (volume monté)
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin budget \
    && mkdir /data && chown 10001:10001 /data
USER 10001:10001

EXPOSE 8501
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8501/_stcore/health', timeout=3)"

CMD ["streamlit", "run", "app/Accueil.py"]
