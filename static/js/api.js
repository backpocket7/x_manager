const API = {
    async get(path) {
        const res = await fetch(path);
        if (!res.ok) throw await res.json();
        return res.json();
    },

    async post(path, data) {
        const res = await fetch(path, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data),
        });
        if (!res.ok) throw await res.json();
        return res.json();
    },

    async put(path, data) {
        const res = await fetch(path, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data),
        });
        if (!res.ok) throw await res.json();
        return res.json();
    },

    async del(path) {
        const res = await fetch(path, {method: 'DELETE'});
        if (!res.ok && res.status !== 204) throw await res.json();
        return null;
    },
};
